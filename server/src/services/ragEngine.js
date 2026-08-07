import { config } from '../config.js';
import { getEmbeddingDiagnostics } from '../utils/embedding.js';
import { authorizeKnowledgeScopes, requireTenantContext } from '../security/tenantContext.js';

function redactConnection (uri) {
    if (!uri) return 'not configured';
    try {
        const parsed = new URL(uri);
        const dbName = parsed.pathname?.replace(/^\//, '') || 'default-db';
        return `${parsed.protocol}//${parsed.hostname}/${dbName}`;
    } catch {
        return uri.replace(/\/\/([^:@]+):([^@]+)@/, '//***:***@');
    }
}

// 如实解析 embedding 实际生效的 provider：
// 配了真实 provider（如 dashscope）但缺 API key 时，embedTextReal 会静默回退到本地哈希，
// 因此状态必须显示 local-fallback，不能谎称 dashscope / openai。
function resolveEffectiveEmbeddingProvider () {
    const isAtlas = config.ragBackend === 'mongodb-atlas';
    if (!isAtlas) return 'local-deterministic-embedding';
    const provider = config.embeddingProvider;
    const hasKey = Boolean(config.embeddingApiKey);
    if (!provider || provider === 'local' || !hasKey) {
        return `local-fallback(${config.embeddingModel})`;
    }
    return provider;
}

export function getRagStatus (extra = {}) {
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
    const effectiveEmbeddingProvider = resolveEffectiveEmbeddingProvider();
    // productionReady 不仅要求 Atlas 向量索引可连，还要求 embedding 真实可用（有 key）。
    // 否则只是“本地哈希 + Atlas 向量库”的伪生产态，不应标为 productionReady。
    const embeddingLive = !effectiveEmbeddingProvider.startsWith('local-fallback');
    const productionReady = isAtlas
        ? vectorSearchReady === true && embeddingLive
        : requestedRealVector && realStoreConnected && mode === 'live';

    return {
        backend,
        mode,
        productionReady,
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
        // 如实反映 embedding 真实状态：配了 dashscope 但无 key → 显示 local-fallback，不再谎称 dashscope
        embeddingProvider: effectiveEmbeddingProvider,
        storeKind: extra.storeKind,
        connected: realStoreConnected,
        vectorSearchReady,
        error: extra.error || (!realStoreConnected && requestedRealVector ? 'Configured vector backend is not connected to a MongoDB store.' : undefined)
    };
}

async function gatherDiagnostics (store, context, query = '') {
    const diagnostics = {
        chunkCount: 0,
        documentCount: 0,
        vectorSearchReady: false,
        embeddingProvider: 'unknown',
        embedding: getEmbeddingDiagnostics()
    };
    try {
        if (typeof store.countChunks === 'function') diagnostics.chunkCount = await store.countChunks(context);
        if (typeof store.listDocuments === 'function') diagnostics.documentCount = (await store.listDocuments(context)).length;
        if (typeof store.checkVectorSearch === 'function') {
            const vs = await store.checkVectorSearch();
            diagnostics.vectorSearchReady = vs.ok === true;
            diagnostics.vectorSearchDetail = vs;
            diagnostics.embeddingDimensionsInIndex = vs.dimensions;
        }
        if (query) {
            try {
                const { embedTextReal } = await import('../utils/embedding.js');
                const queryVector = await embedTextReal(query, { useReal: true });
                diagnostics.queryVectorDimensions = queryVector.length;
                diagnostics.queryEmbeddingProvider = diagnostics.embedding.effectiveProvider;
            } catch (embeddingError) {
                diagnostics.queryEmbeddingError = embeddingError.message;
            }
        }
    } catch (error) {
        diagnostics.error = error.message;
    }
    return diagnostics;
}

export async function retrieveKnowledge ({ store, context, query, scopes, limit = 5 }) {
    requireTenantContext(context);
    const authorizedScopes = authorizeKnowledgeScopes(context, scopes);
    const diagnostics = await gatherDiagnostics(store, context, query);

    if (config.ragBackend === 'mongodb-atlas' && typeof store.searchVectorChunks === 'function') {
        try {
            const sources = await store.searchVectorChunks(context, query, {
                scopes: authorizedScopes,
                limit,
                numCandidates: Math.max(limit * 16, 80)
            });

            return {
                status: getRagStatus({ mode: 'live', storeKind: store.kind, vectorSearchReady: true }),
                sources: enrichSources(sources, {
                    backend: 'mongodb-atlas-vector-search',
                    strategy: 'atlas-vector-prefilter',
                    scopes: authorizedScopes
                }),
                filter: { tenantApplied: true, scopeApplied: true },
                filteredChunks: [],
                diagnostics
            };
        } catch (error) {
            const fallback = await retrieveLocalKnowledge({ store, context, query, scopes: authorizedScopes, limit });
            return {
                status: getRagStatus({ mode: 'fallback', storeKind: store.kind, vectorSearchReady: false, error: error.message }),
                sources: enrichSources(fallback.sources, {
                    backend: 'local-hash-fallback',
                    strategy: 'local-tenant-scope-prefilter',
                    scopes: authorizedScopes,
                    fallbackReason: error.message
                }),
                filter: { tenantApplied: true, scopeApplied: true },
                filteredChunks: [],
                diagnostics: { ...diagnostics, error: error.message }
            };
        }
    }

    const local = await retrieveLocalKnowledge({ store, context, query, scopes: authorizedScopes, limit });
    return { ...local, diagnostics };
}

async function retrieveLocalKnowledge ({ store, context, query, scopes, limit = 5 }) {
    const chunks = await store.searchChunks(context, query, {
        scopes,
        limit: Math.max(limit, 8)
    });

    return {
        status: getRagStatus({ storeKind: store.kind, error: store.connectionError }),
        sources: enrichSources(chunks.slice(0, limit), {
            backend: 'local-hash',
            strategy: 'local-tenant-scope-prefilter',
            scopes
        }),
        filter: { tenantApplied: true, scopeApplied: true },
        filteredChunks: []
    };
}

function enrichSources (sources, { backend, strategy, scopes = [], fallbackReason = '' } = {}) {
    return sources.map((source, index) => {
        const score = Number(source.score || 0);
        const matchedScopes = (source.scopes || []).filter((scope) => scopes.includes(scope));
        const scopeReason = `tenant and scope prefilter passed: ${matchedScopes.join(', ')}`;
        return {
            ...source,
            retrievalBackend: source.retrievalBackend || backend,
            candidateRank: index + 1,
            rerankScore: score,
            rerankStrategy: strategy,
            filterReason: fallbackReason
                ? `${scopeReason}; fallback reason: ${fallbackReason}`
                : scopeReason
        };
    });
}

export async function checkVectorHealth ({ store, context }) {
    if (config.ragBackend !== 'mongodb-atlas') {
        return getRagStatus({ storeKind: store?.kind });
    }

    if (!store || typeof store.searchVectorChunks !== 'function') {
        return getRagStatus({
            storeKind: store?.kind,
            vectorSearchReady: false,
            mode: 'unavailable',
            error: 'Vector store not connected'
        });
    }

    try {
        // 真正执行 $vectorSearch 探测
        await store.searchVectorChunks(context, 'health check probe', {
            scopes: ['copilot'],
            limit: 1,
            numCandidates: 10
        });
        return getRagStatus({
            mode: 'live',
            storeKind: store.kind,
            vectorSearchReady: true
        });
    } catch (error) {
        return getRagStatus({
            mode: 'fallback',
            storeKind: store?.kind,
            vectorSearchReady: false,
            error: error.message
        });
    }
}
