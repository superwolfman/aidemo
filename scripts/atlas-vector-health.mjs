import { MongoClient, ObjectId } from 'mongodb';
import { config } from '../server/src/config.js';
import { embedText } from '../server/src/utils/embedding.js';

function hasFlag(name) {
  return process.argv.includes(name);
}

async function ensureSeedChunk(db) {
  const chunks = db.collection('chunks');
  const existing = await chunks.countDocuments();
  if (existing > 0 && !hasFlag('--seed')) return existing;

  const documentId = new ObjectId();
  const content = [
    'AI Product Workflow uses SkillDefinition, RAG retrieval, SSE streaming,',
    'Agent Trace, Product Requirement Document artifacts and Human-in-the-loop approval.',
    'This chunk is used to verify MongoDB Atlas Vector Search end-to-end.'
  ].join(' ');

  await db.collection('documents').insertOne({
    _id: documentId,
    title: 'Atlas Vector Search Health Fixture',
    content,
    tags: ['copilot', 'architecture', 'standards'],
    sourceType: 'system-health',
    sourcePath: 'scripts/atlas-vector-health.mjs',
    chunkCount: 1,
    createdAt: new Date()
  });

  await chunks.insertOne({
    documentId,
    documentTitle: 'Atlas Vector Search Health Fixture',
    tags: ['copilot', 'architecture', 'standards'],
    sourceType: 'system-health',
    sourcePath: 'scripts/atlas-vector-health.mjs',
    content,
    chunkIndex: 0,
    embedding: embedText(content),
    createdAt: new Date()
  });

  return chunks.countDocuments();
}

async function requestSearchIndex(db) {
  const chunks = db.collection('chunks');
  if (!hasFlag('--create-index')) return { requested: false };
  if (typeof chunks.createSearchIndex !== 'function') {
    return { requested: false, error: 'mongodb driver does not expose createSearchIndex on this collection' };
  }

  try {
    const result = await chunks.createSearchIndex({
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
          {
            type: 'filter',
            path: 'tags'
          }
        ]
      }
    });
    return { requested: true, result };
  } catch (error) {
    return { requested: false, error: error.message };
  }
}

async function run() {
  if (config.ragBackend !== 'mongodb-atlas') {
    throw new Error(`RAG_BACKEND must be mongodb-atlas, got ${config.ragBackend}`);
  }
  if (!config.mongodbUri?.startsWith('mongodb+srv://')) {
    throw new Error('MONGODB_ATLAS_URI or MONGODB_URI must be a MongoDB Atlas mongodb+srv:// connection string.');
  }

  const client = new MongoClient(config.mongodbUri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const db = client.db();

  const chunks = await ensureSeedChunk(db);
  const index = await requestSearchIndex(db);
  const queryVector = embedText('AI 产品工作流 PRD 页面原型 接口协议 Agent Trace');
  const results = await db.collection('chunks').aggregate([
    {
      $vectorSearch: {
        index: config.ragVectorIndex,
        path: config.ragVectorPath,
        queryVector,
        numCandidates: 32,
        limit: 3
      }
    },
    {
      $project: {
        documentTitle: 1,
        sourcePath: 1,
        chunkIndex: 1,
        content: 1,
        score: { $meta: 'vectorSearchScore' }
      }
    }
  ]).toArray();

  await client.close();

  console.log(JSON.stringify({
    ok: true,
    backend: config.ragBackend,
    vectorStore: 'MongoDB Atlas Vector Search',
    index: config.ragVectorIndex,
    vectorPath: config.ragVectorPath,
    dimensions: config.ragVectorDimensions,
    chunks,
    indexRequest: index,
    hits: results.map((item) => ({
      title: item.documentTitle,
      score: Number(item.score || 0).toFixed(4),
      sourcePath: item.sourcePath,
      chunkIndex: item.chunkIndex
    }))
  }, null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    hint: [
      'Set RAG_BACKEND=mongodb-atlas',
      'Set MONGODB_ATLAS_URI=mongodb+srv://<user>:<password>@<cluster>/<db>',
      'Create Atlas Vector Search index on chunks.embedding',
      'Run: npm run vector:health -- --seed',
      'If index does not exist, run once with: npm run vector:health -- --seed --create-index'
    ]
  }, null, 2));
  process.exit(1);
});
