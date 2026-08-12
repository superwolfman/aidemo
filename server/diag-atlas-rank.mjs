import { MongoClient } from 'mongodb';
import { config } from './src/config.js';
import { buildTenantVectorPipeline } from './src/store/mongoStore.js';
import { createServiceTenantContext, authorizeKnowledgeScopes } from './src/security/tenantContext.js';
import { embedTextReal } from './src/utils/embedding.js';

const QUERY = process.argv[2] || '建设一个前端可观测性平台从需求到交付：实现错误采集与 Source Map 反解、Web Vitals 与白屏监控、TraceId 全链路追踪、告警分级与 MTTR 闭环、灰度回滚高可用架构';
const SCOPES = (process.argv[3] || 'architecture,standards,ai-native,frontend,frontend-observability,engineering-governance,performance').split(',').map(s => s.trim());
const TENANT_ID = process.argv[4] || 'tenant-demo';
const LIMIT = Number(process.argv[5] || 20);

console.log('=== Atlas RAG Diagnostic ===');
console.log('QUERY:', QUERY.slice(0, 80) + (QUERY.length > 80 ? '...' : ''));
console.log('SCOPES:', SCOPES.join(', '));
console.log('TENANT:', TENANT_ID);
console.log('LIMIT:', LIMIT);
console.log('RAG_BACKEND:', config.ragBackend);
console.log('VECTOR_INDEX:', config.ragVectorIndex);
console.log('VECTOR_DIMS:', config.ragVectorDimensions);

if (config.ragBackend !== 'mongodb-atlas') {
  console.error('ERROR: RAG backend is not mongodb-atlas');
  process.exit(1);
}

const uri = process.env.MONGODB_ATLAS_URI || process.env.MONGODB_URI || config.mongodbUri;
if (!uri) {
  console.error('ERROR: MongoDB URI not configured');
  process.exit(1);
}

const context = createServiceTenantContext({ tenantId: TENANT_ID, role: 'admin', allowedKnowledgeScopes: ['*'] });
const authorizedScopes = authorizeKnowledgeScopes(context, SCOPES);
console.log('AUTHORIZED_SCOPES:', authorizedScopes.join(', '));

console.log('\n[1/3] Embedding query with real provider...');
const queryEmbedding = await embedTextReal(QUERY, { useReal: true, skipCache: true });
console.log('EMBEDDING_LENGTH:', queryEmbedding.length);
console.log('EMBEDDING_SAMPLE:', queryEmbedding.slice(0, 5).map(n => n.toFixed(4)));

console.log('\n[2/3] Running Atlas $vectorSearch...');
const client = new MongoClient(uri);
await client.connect();
const dbName = new URL(uri).pathname.replace(/^\//, '') || 'aidemo';
const db = client.db(dbName);

const pipeline = buildTenantVectorPipeline({
  context,
  scopes: authorizedScopes,
  queryEmbedding,
  limit: LIMIT,
  numCandidates: Math.max(LIMIT * 16, 80),
  tenantOnly: false
});

console.log('PIPELINE:', JSON.stringify(pipeline, null, 2));

const results = await db.collection('chunks').aggregate(pipeline).toArray();
console.log('\n[3/3] Results count:', results.length);

console.log('\n=== TOP RESULTS ===');
results.forEach((r, i) => {
  const isDomain = r.documentTitle?.includes('前端可观测');
  const marker = isDomain ? ' <<<<< DOMAIN DOC' : '';
  console.log(`\n#${i + 1}  score=${r.vectorScore?.toFixed(4)}  title=${r.documentTitle}${marker}`);
  console.log(`    sourceType=${r.sourceType || 'n/a'}  scopes=[${(r.scopes || []).join(', ')}]`);
  console.log(`    path=${r.sourcePath || 'n/a'}  chunk=${r.chunkIndex}`);
  console.log(`    content=${String(r.content || '').slice(0, 120).replace(/\s+/g, ' ')}...`);
});

// Specifically check domain doc
const domainDoc = await db.collection('documents').findOne(
  { title: { $regex: '前端可观测' } },
  { projection: { _id: 1, title: 1, scopes: 1, chunkCount: 1 } }
);

if (domainDoc) {
  console.log('\n=== DOMAIN DOC STATUS ===');
  console.log('document:', JSON.stringify(domainDoc));
  const inResults = results.some(r => String(r.documentId) === String(domainDoc._id));
  console.log('in_top_results:', inResults);
  if (!inResults) {
    console.log('WARNING: domain doc not in Atlas vector search top results');
    const domainChunks = await db.collection('chunks').countDocuments({ documentId: domainDoc._id });
    console.log('domain_chunks_count:', domainChunks);
  }
} else {
  console.log('\nWARNING: domain doc not found in documents collection');
}

await client.close();
console.log('\n=== Done ===');
