import { config } from '../config.js';

export function getRagStatus(extra = {}) {
  const backend = config.ragBackend;
  const isAtlas = backend === 'mongodb-atlas';
  return {
    backend,
    mode: extra.mode || (backend === 'local-hash' ? 'local' : 'configured'),
    productionReady: backend !== 'local-hash' && extra.mode !== 'fallback',
    vectorStore:
      isAtlas
        ? 'MongoDB Atlas Vector Search'
        : backend === 'pgvector'
          ? 'Postgres pgvector'
          : backend === 'milvus'
            ? 'Milvus'
            : 'Local hash embedding',
    connection: backend === 'local-hash' ? 'in-process' : config.mongodbUri,
    index: isAtlas ? config.ragVectorIndex : undefined,
    vectorPath: isAtlas ? config.ragVectorPath : undefined,
    dimensions: isAtlas ? config.ragVectorDimensions : undefined,
    error: extra.error
  };
}

export async function retrieveKnowledge({ store, query, scopes, limit = 5 }) {
  if (config.ragBackend === 'mongodb-atlas' && typeof store.searchVectorChunks === 'function') {
    try {
      const sources = await store.searchVectorChunks(`${query} ${scopes.join(' ')}`, {
        scopes,
        limit,
        numCandidates: Math.max(limit * 16, 80)
      });

      return {
        status: getRagStatus({ mode: 'live' }),
        sources
      };
    } catch (error) {
      const fallback = await retrieveLocalKnowledge({ store, query, scopes, limit });
      return {
        status: getRagStatus({ mode: 'fallback', error: error.message }),
        sources: fallback.sources.map((source) => ({
          ...source,
          retrievalBackend: 'local-hash-fallback'
        }))
      };
    }
  }

  return retrieveLocalKnowledge({ store, query, scopes, limit });
}

async function retrieveLocalKnowledge({ store, query, scopes, limit = 5 }) {
  const chunks = await store.searchChunks(`${query} ${scopes.join(' ')}`, Math.max(limit, 8));
  const filtered = chunks.filter((chunk) => {
    const tags = chunk.tags || [];
    return !tags.length || tags.some((tag) => scopes.includes(tag) || tag === 'copilot');
  });

  return {
    status: getRagStatus(),
    sources: (filtered.length ? filtered : chunks).slice(0, limit).map((source) => ({
      ...source,
      retrievalBackend: source.retrievalBackend || 'local-hash'
    }))
  };
}
