import { config } from '../src/config.js';
import { ragGoldenDataset, RAG_GOLDEN_DATASET_VERSION } from '../src/knowledge/ragGoldenDataset.js';
import { scopesForKnowledgeDomain } from '../src/knowledge/knowledgeDomain.js';
import { createServiceTenantContext } from '../src/security/tenantContext.js';
import { calibrateRelevanceThreshold } from '../src/services/ragEvaluation.js';
import { createStore } from '../src/store/index.js';
import { seedKnowledgeIfEmpty } from '../src/utils/seedKnowledge.js';

const apply = process.argv.includes('--apply');
const tenantArg = process.argv.find((arg) => arg.startsWith('--tenant='));
const tenantId = tenantArg?.split('=')[1] || config.demoTenantId || 'tenant-demo';
const context = createServiceTenantContext({
    tenantId,
    actorId: 'rag-golden-evaluator',
    allowedKnowledgeScopes: ['*']
});
const store = await createStore();
await seedKnowledgeIfEmpty(store, { tenantId, actorId: context.actorId });

const profiles = [];
for (const domain of [...new Set(ragGoldenDataset.map((item) => item.domain))]) {
    const cases = ragGoldenDataset.filter((item) => item.domain === domain);
    const resultsByCase = new Map();
    for (const item of cases) {
        const search = typeof store.searchVectorChunks === 'function'
            ? store.searchVectorChunks.bind(store)
            : store.searchChunks.bind(store);
        const results = await search(context, item.query, {
            scopes: scopesForKnowledgeDomain(domain),
            limit: 20,
            numCandidates: 320
        });
        resultsByCase.set(item.id, results);
    }
    const metrics = calibrateRelevanceThreshold({ cases, resultsByCase, topK: 5 });
    const profile = {
        domain,
        datasetVersion: RAG_GOLDEN_DATASET_VERSION,
        embeddingProvider: config.embeddingProvider,
        embeddingModel: config.embeddingModel,
        vectorIndex: config.ragVectorIndex,
        evaluatedAt: new Date().toISOString(),
        ...metrics
    };
    profiles.push(profile);
    if (apply && typeof store.saveRagCalibration === 'function') {
        await store.saveRagCalibration(context, profile);
    }
}

console.log(JSON.stringify({
    environment: config.mongodbEnvironment,
    database: config.mongodbDatabase,
    tenantId,
    applied: apply,
    profiles
}, null, 2));

await store.client?.close?.();
