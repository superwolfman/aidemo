import { config } from '../config.js';
import { getEmbeddingDiagnostics } from '../utils/embedding.js';
import { authorizeKnowledgeScopes, requireTenantContext } from '../security/tenantContext.js';

function redactConnection (uri, databaseName) {
    if (!uri) return 'not configured';
    try {
        const parsed = new URL(uri);
        return `${parsed.protocol}//${parsed.hostname}/${databaseName || 'database-not-configured'}`;
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
        connection: backend === 'local-hash' ? 'in-process' : redactConnection(config.mongodbUri, config.mongodbDatabase),
        databaseEnvironment: config.mongodbEnvironment,
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

export function buildVectorSearchPlan (limit = 5) {
    const topK = Math.max(1, Number(limit) || 5);
    // Atlas 先扩大候选池，再做业务重排。这里与线上诊断脚本保持同一口径：
    // top5 至少召回 20 个候选，避免只对向量 top8 重排导致领域文档根本没有参赛。
    const candidateLimit = Math.max(topK * 4, 20);
    return {
        topK,
        candidateLimit,
        numCandidates: Math.max(candidateLimit * 16, 80)
    };
}

function buildRetrievalDiagnostics (diagnostics, query, plan, strategy) {
    return {
        ...diagnostics,
        retrieval: {
            query,
            queryStrategy: strategy,
            requestedTopK: plan.topK,
            candidateLimit: plan.candidateLimit,
            numCandidates: plan.numCandidates
        }
    };
}

function toFilteredChunk (source, index, topK) {
    return {
        id: source._id,
        title: source.documentTitle || source.title,
        score: Number(source.score || 0),
        reason: `scope precision rerank rank ${index + 1}，超出 topK ${topK}`
    };
}

export async function retrieveKnowledge ({ store, context, query, scopes, limit = 5 }) {
    requireTenantContext(context);
    const authorizedScopes = authorizeKnowledgeScopes(context, scopes);
    const diagnostics = await gatherDiagnostics(store, context, query);
    const vectorPlan = buildVectorSearchPlan(limit);

    if (config.ragBackend === 'mongodb-atlas' && typeof store.searchVectorChunks === 'function') {
        try {
            const rawSources = await store.searchVectorChunks(context, query, {
                scopes: authorizedScopes,
                limit: vectorPlan.candidateLimit,
                numCandidates: vectorPlan.numCandidates
            });

            const rankedSources = rerankByScopePrecision(
                rawSources.map((source, index) => ({ ...source, vectorRank: index + 1 })),
                authorizedScopes
            );
            const sources = rankedSources.slice(0, vectorPlan.topK);

            return {
                status: getRagStatus({ mode: 'live', storeKind: store.kind, vectorSearchReady: true }),
                sources: enrichSources(sources, {
                    backend: 'mongodb-atlas-vector-search',
                    strategy: 'atlas-vector-prefilter + bounded-scope-odds-rerank',
                    scopes: authorizedScopes
                }),
                filter: { tenantApplied: true, scopeApplied: true },
                filteredChunks: rankedSources
                    .slice(vectorPlan.topK)
                    .map((source, index) => toFilteredChunk(source, index + vectorPlan.topK, vectorPlan.topK)),
                diagnostics: buildRetrievalDiagnostics(
                    diagnostics,
                    query,
                    vectorPlan,
                    'business-requirement + atlas-vector-prefilter + bounded-scope-odds-rerank'
                )
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
                diagnostics: buildRetrievalDiagnostics(
                    { ...diagnostics, error: error.message },
                    query,
                    vectorPlan,
                    'business-requirement + local-fallback'
                )
            };
        }
    }

    const local = await retrieveLocalKnowledge({ store, context, query, scopes: authorizedScopes, limit });
    return {
        ...local,
        diagnostics: buildRetrievalDiagnostics(
            diagnostics,
            query,
            vectorPlan,
            'business-requirement + local-hash'
        )
    };
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

const BROAD_SCOPES = new Set([
    'architecture',
    'frontend',
    'ai-native',
    'standards'
]);

/**
 * 对 Atlas 向量召回结果按 scope 精确度重排序。
 * - 命中更细分领域 scope（如 frontend-observability）的 chunk 在 odds 空间获得 boost，避免被
 *   architecture/frontend/ai-native 这类宽泛 scope 的通用模板淹没。
 * - 未命中任何精确 scope 的 project-file 类型 chunk（如 Copilot 自身源码）在 odds 空间受到 penalty，
 *   降低其排在 top5 的概率。
 * - 最终 relevance 保持在 [0, 1]；它是排序相关度，不是模型置信概率。
 */
export function rerankByScopePrecision (sources, scopes, {
    boostFactor = 1.5,
    projectFilePenalty = 0.5
} = {}) {
    if (!sources?.length) return sources;

    const preciseScopes = scopes.filter((s) => !BROAD_SCOPES.has(s));

    return sources
        .map((source) => {
            const sourceScopes = source.scopes || [];
            const matchedPrecise = preciseScopes.filter((s) => sourceScopes.includes(s));
            const hasPreciseMatch = matchedPrecise.length > 0;
            const isProjectFile = source.sourceType === 'project-file';

            let factor = 1.0;
            if (hasPreciseMatch) factor *= boostFactor;
            if (isProjectFile && !hasPreciseMatch) factor *= projectFilePenalty;

            const baseScore = Number(source.score ?? source.rerankScore ?? 0);
            const rerankScore = applyOddsFactor(baseScore, factor);
            return {
                ...source,
                score: rerankScore,
                rerankScore,
                rerankReason: hasPreciseMatch
                    ? `scope precision odds boost (${boostFactor}x): ${matchedPrecise.join(', ')}`
                    : isProjectFile
                        ? `project-file odds penalty (${projectFilePenalty}x): no precise scope match`
                        : 'no scope adjustment'
            };
        })
        .sort((a, b) => b.score - a.score);
}

/**
 * 在 odds 空间施加业务权重，输出仍保持在 [0, 1]。
 * 相比直接 score * factor，不会出现 1.30 这类容易被误解为概率的展示值；
 * 相比 Math.min(score, 1)，不会把所有高分结果压成相同的 1。
 */
export function applyOddsFactor (score, factor = 1) {
    const numericScore = Number(score);
    const boundedScore = Number.isFinite(numericScore)
        ? Math.min(1, Math.max(0, numericScore))
        : 0;
    if (boundedScore === 0 || boundedScore === 1) return boundedScore;

    const numericFactor = Number(factor);
    const safeFactor = Number.isFinite(numericFactor) && numericFactor > 0 ? numericFactor : 1;
    const adjusted = (boundedScore * safeFactor) /
        ((1 - boundedScore) + (boundedScore * safeFactor));
    return Number(adjusted.toFixed(4));
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
            rerankScore: Number(source.rerankScore || score),
            rerankStrategy: source.rerankStrategy || strategy,
            filterReason: source.rerankReason || fallbackReason
                ? `${scopeReason}; ${source.rerankReason || `fallback reason: ${fallbackReason}`}`
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
