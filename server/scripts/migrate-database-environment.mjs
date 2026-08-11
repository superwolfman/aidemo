import { MongoClient } from 'mongodb';
import { config } from '../src/config.js';
import { ensureMongoDatabaseEnvironment } from '../src/store/mongoDatabase.js';

function argument (name, fallback = '') {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? String(process.argv[index + 1] || '').trim() : fallback;
}

const apply = process.argv.includes('--apply');
const sourceName = argument('source', process.env.MONGODB_LEGACY_DB_NAME || 'growth_ai_assistant');
const targetName = argument('target', config.mongodbDatabase);

if (sourceName === targetName) {
    throw new Error('Source and target MongoDB databases must be different');
}
if (targetName !== config.mongodbDatabase) {
    throw new Error(`Target must match configured MONGODB_DB_NAME (${config.mongodbDatabase})`);
}

const client = new MongoClient(config.mongodbUri);
await client.connect();

try {
    const source = client.db(sourceName);
    const target = client.db(targetName);
    const collections = (await source.listCollections({}, { nameOnly: true }).toArray())
        .map((item) => item.name)
        .filter((name) => !name.startsWith('system.') && name !== 'environment_metadata');
    const plan = [];
    for (const name of collections) {
        plan.push({
            collection: name,
            sourceCount: await source.collection(name).countDocuments(),
            targetCount: await target.collection(name).countDocuments()
        });
    }

    console.log(JSON.stringify({
        mode: apply ? 'apply' : 'dry-run',
        environment: config.mongodbEnvironment,
        source: sourceName,
        target: targetName,
        collections: plan
    }, null, 2));

    if (!apply) {
        console.log('Dry run only. Re-run with --apply after reviewing the plan.');
        process.exit(0);
    }

    for (const { collection: name } of plan) {
        const sourceCollection = source.collection(name);
        const targetCollection = target.collection(name);
        let operations = [];
        for await (const document of sourceCollection.find({})) {
            operations.push({
                replaceOne: {
                    filter: { _id: document._id },
                    replacement: document,
                    upsert: true
                }
            });
            if (operations.length === 250) {
                await targetCollection.bulkWrite(operations, { ordered: false });
                operations = [];
            }
        }
        if (operations.length) {
            await targetCollection.bulkWrite(operations, { ordered: false });
        }

        const indexes = await sourceCollection.listIndexes().toArray().catch(() => []);
        for (const index of indexes.filter((item) => item.name !== '_id_')) {
            const { key, name: indexName, unique, sparse, expireAfterSeconds, partialFilterExpression } = index;
            await targetCollection.createIndex(key, {
                name: indexName,
                ...(unique !== undefined ? { unique } : {}),
                ...(sparse !== undefined ? { sparse } : {}),
                ...(expireAfterSeconds !== undefined ? { expireAfterSeconds } : {}),
                ...(partialFilterExpression ? { partialFilterExpression } : {})
            });
        }
    }

    await ensureMongoDatabaseEnvironment(target, config.mongodbEnvironment);

    if (config.ragBackend === 'mongodb-atlas' && collections.includes('chunks')) {
        const chunks = target.collection('chunks');
        try {
            await chunks.createSearchIndex({
                name: config.ragVectorIndex,
                type: 'vectorSearch',
                definition: {
                    fields: [
                        {
                            type: 'vector',
                            path: config.ragVectorPath,
                            numDimensions: config.ragVectorDimensions,
                            similarity: 'cosine'
                        },
                        { type: 'filter', path: 'tenantId' },
                        { type: 'filter', path: 'scopes' }
                    ]
                }
            });
            console.log(`Requested Atlas Vector Search index ${config.ragVectorIndex} in ${targetName}.chunks`);
        } catch (error) {
            console.warn(`Vector index request skipped: ${error.message}`);
        }
    }

    const verification = [];
    for (const { collection: name, sourceCount } of plan) {
        const targetCount = await target.collection(name).countDocuments();
        verification.push({ collection: name, sourceCount, targetCount, ok: targetCount >= sourceCount });
    }
    if (verification.some((item) => !item.ok)) {
        throw new Error(`Database copy verification failed: ${JSON.stringify(verification)}`);
    }
    console.log(JSON.stringify({ migrated: true, source: sourceName, target: targetName, verification }, null, 2));
} finally {
    await client.close();
}
