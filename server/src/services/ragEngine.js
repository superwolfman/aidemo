import { config } from '../config.js';

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

export async function retrieveKnowledge ({ store, query, scopes, limit = 5 }) {
    if (config.ragBackend === 'mongodb-atlas' && typeof store.searchVectorChunks === 'function') {
        try {
            const sources = await store.searchVectorChunks(`${query} ${scopes.join(' ')}`, {
                scopes,
                limit,
                numCandidates: Math.max(limit * 16, 80)
            });

            return {
                status: getRagStatus({ mode: 'live', storeKind: store.kind, vectorSearchReady: true }),
                sources: enrichSources(sources, {
                    backend: 'mongodb-atlas-vector-search',
                    strategy: 'atlas-vector-score',
                    scopes
                })
            };
        } catch (error) {
            const fallback = await retrieveLocalKnowledge({ store, query, scopes, limit });
            return {
                status: getRagStatus({ mode: 'fallback', storeKind: store.kind, vectorSearchReady: false, error: error.message }),
                sources: enrichSources(fallback.sources, {
                    backend: 'local-hash-fallback',
                    strategy: 'local-score-desc-scope-filter',
                    scopes,
                    fallbackReason: error.message
                })
            };
        }
    }

    return retrieveLocalKnowledge({ store, query, scopes, limit });
}

async function retrieveLocalKnowledge ({ store, query, scopes, limit = 5 }) {
    const chunks = await store.searchChunks(`${query} ${scopes.join(' ')}`, Math.max(limit, 8));
    const filtered = chunks.filter((chunk) => {
        const tags = chunk.tags || [];
        return !tags.length || tags.some((tag) => scopes.includes(tag) || tag === 'copilot');
    });

    return {
        status: getRagStatus({ storeKind: store.kind, error: store.connectionError }),
        sources: enrichSources((filtered.length ? filtered : chunks).slice(0, limit), {
            backend: 'local-hash',
            strategy: 'local-score-desc-scope-filter',
            scopes,
            usedFallbackPool: !filtered.length
        })
    };
}

function enrichSources (sources, { backend, strategy, scopes = [], fallbackReason = '', usedFallbackPool = false } = {}) {
    return sources.map((source, index) => {
        const score = Number(source.score || 0);
        const tags = source.tags || [];
        const matchedScopes = tags.filter((tag) => scopes.includes(tag) || tag === 'copilot');
        const scopeReason = matchedScopes.length
            ? `passed scope filter: ${matchedScopes.join(', ')}`
            : usedFallbackPool
                ? 'returned from fallback candidate pool because scoped chunks were empty'
                : 'passed default untagged/candidate filter';
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

export async function checkVectorHealth ({ store }) {
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
        await store.searchVectorChunks('health check probe', {
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
