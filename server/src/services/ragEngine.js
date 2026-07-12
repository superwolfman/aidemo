import { config } from '../config.js';

export function getRagStatus() {
  const backend = process.env.RAG_BACKEND || 'local-hash';
  return {
    backend,
    productionReady: backend !== 'local-hash',
    vectorStore:
      backend === 'mongodb-atlas'
        ? 'MongoDB Atlas Vector Search'
        : backend === 'pgvector'
          ? 'Postgres pgvector'
          : backend === 'milvus'
            ? 'Milvus'
            : 'Local hash embedding',
    connection: backend === 'local-hash' ? 'in-process' : config.mongodbUri
  };
}

export async function retrieveKnowledge({ store, query, scopes, limit = 5 }) {
  const chunks = await store.searchChunks(`${query} ${scopes.join(' ')}`, Math.max(limit, 8));
  const filtered = chunks.filter((chunk) => {
    const tags = chunk.tags || [];
    return !tags.length || tags.some((tag) => scopes.includes(tag) || tag === 'copilot');
  });

  return {
    status: getRagStatus(),
    sources: (filtered.length ? filtered : chunks).slice(0, limit)
  };
}
