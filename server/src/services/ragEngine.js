import { config } from '../config.js';

function redactConnection(uri) {
  if (!uri) return 'not configured';
  try {
    const parsed = new URL(uri);
    const dbName = parsed.pathname?.replace(/^\//, '') || 'default-db';
    return `${parsed.protocol}//${parsed.hostname}/${dbName}`;
  } catch {
    return uri.replace(/\/\/([^:@]+):([^@]+)@/, '//***:***@');
  }
}

export function getRagStatus(extra = {}) {
  const backend = config.ragBackend;
  const isAtlas = backend === 'mongodb-atlas';
  const realStoreConnected = backend === 'local-hash' || extra.storeKind === 'mongo';
  const requestedRealVector = backend !== 'local-hash';
  const vectorSearchReady = extra.vectorSearchReady;
  const mode =
    extra.mode ||
    (backend === 'local-hash'
      ? 'local'
      : realStoreConnected
        ? 'configured'
        : 'unavailable');
  return {
    backend,
    mode,
    productionReady: requestedRealVector && realStoreConnected && mode !== 'fallback' && vectorSearchReady !== false,
    retrievalBackend:
      isAtlas && vectorSearchReady
        ? 'mongodb-atlas-vector-search'
        : backend === 'local-hash'
          ? 'local-hash'
          : 'local-hash-fallback',
    vectorStore:
      isAtlas
        ? 'MongoDB Atlas Vector Search'
        : backend === 'pgvector'
          ? 'Postgres pgvector'
          : backend === 'milvus'
            ? 'Milvus'
            : 'Local hash embedding',
    connection: backend === 'local-hash' ? 'in-process' : redactConnection(config.mongodbUri),
    index: isAtlas ? config.ragVectorIndex : undefined,
    vectorPath: isAtlas ? config.ragVectorPath : undefined,
    dimensions: isAtlas ? config.ragVectorDimensions : undefined,
    embeddingProvider: 'local-deterministic-embedding',
    storeKind: extra.storeKind,
    connected: realStoreConnected,
    vectorSearchReady,
    error: extra.error || (!realStoreConnected && requestedRealVector ? 'Configured vector backend is not connected to a MongoDB store.' : undefined)
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
        status: getRagStatus({ mode: 'live', storeKind: store.kind, vectorSearchReady: true }),
        sources
      };
    } catch (error) {
      const fallback = await retrieveLocalKnowledge({ store, query, scopes, limit });
      return {
        status: getRagStatus({ mode: 'fallback', storeKind: store.kind, vectorSearchReady: false, error: error.message }),
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
    status: getRagStatus({ storeKind: store.kind, error: store.connectionError }),
    sources: (filtered.length ? filtered : chunks).slice(0, limit).map((source) => ({
      ...source,
      retrievalBackend: source.retrievalBackend || 'local-hash'
    }))
  };
}
