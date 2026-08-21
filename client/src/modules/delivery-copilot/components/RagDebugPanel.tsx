import { useId, useState } from 'react';
import { Database, ExternalLink, Globe, ShieldAlert } from 'lucide-react';
import type { FilteredChunk } from '../types';

type Source = {
    _id?: string;
    documentTitle?: string;
    content?: string;
    score?: number;
    vectorScore?: number;
    candidateRank?: number;
    vectorRank?: number;
    rerankScore?: number;
    rerankStrategy?: string;
    filterReason?: string;
    retrievalBackend?: string;
    sourcePath?: string;
    evidenceQuality?: { authority?: string; freshness?: string; ageDays?: number | null };
    knowledgeMetadata?: {
        sourceType?: string;
        authorityLevel?: string;
        isSynthetic?: boolean;
        version?: string;
        effectiveAt?: string;
        reviewDueAt?: string;
        disclaimer?: string;
    };
};

type ExternalSource = {
    sourceType: 'external';
    documentTitle?: string;
    sourceUrl?: string;
    content?: string;
    paragraphs?: Array<{ index: number; text: string }>;
    contentHash?: string;
    crawlTime?: string;
    publishedAt?: string | null;
    authorityLevel?: number;
    authorityLabel?: string;
    relevance?: number;
    requiresHumanReview?: boolean;
    evidenceProvenance?: string;
    writeAllowed?: boolean;
};

type ExternalStatus = {
    enabled?: boolean;
    configured?: boolean;
    provider?: string;
    eligible?: boolean;
    highRisk?: boolean;
    status?: 'ok' | 'disabled' | 'not-eligible' | 'scope-not-eligible' | 'no-hits' | 'timeout' | 'error' | 'skipped' | string;
    fetched?: number;
    accepted?: number;
    skipped?: number;
    error?: string;
    latencyMs?: number;
    timeoutMs?: number;
};

type RagRuntime = {
    retrievalBackend?: string;
    backend?: string;
    vectorStore?: string;
    productionReady?: boolean;
    index?: string;
    vectorPath?: string;
    dimensions?: number;
    connection?: string;
    connected?: boolean;
    error?: string;
};

type RetrievalView = {
    live: boolean;
    backend: string;
    label: string;
    warning?: string;
};

type Diagnostics = {
    chunkCount?: number;
    documentCount?: number;
    vectorSearchReady?: boolean;
    error?: string;
    outcome?: { type?: string; code?: string; message?: string };
    externalStatus?: ExternalStatus;
    retrieval?: {
        query?: string;
        originalQuery?: string;
        fullTextQuery?: string;
        entities?: string[];
        knowledgeDomain?: string | null;
        taskModeId?: string | null;
        effectiveScopes?: string[];
        scopeSource?: string;
        queryStrategy?: string;
        requestedTopK?: number;
        candidateLimit?: number;
        numCandidates?: number;
        outcome?: { type?: string; code?: string; message?: string };
    };
};

type Props = {
    query: string;
    sources: Source[];
    externalSources?: ExternalSource[];
    externalStatus?: ExternalStatus | null;
    ragRuntime?: RagRuntime;
    retrievalView: RetrievalView;
    filteredChunks?: FilteredChunk[];
    diagnostics?: Diagnostics;
};

function shortText(value = '', size = 160) {
    return value.length > size ? `${value.slice(0, size)}...` : value;
}

function displayRelevance(source: Source) {
    const score = Number(source.rerankScore ?? source.score ?? 0);
    if (source.rerankStrategy?.includes('bounded-scope-odds-rerank')) {
        return Math.min(1, Math.max(0, score));
    }

    // 兼容修复前已经持久化的 Run：用原始 vectorScore 和历史 factor 还原为有界 relevance。
    const vectorScore = Number(source.vectorScore);
    const factorMatch = source.filterReason?.match(/\(([0-9.]+)x\)/);
    const factor = Number(factorMatch?.[1]);
    if (Number.isFinite(vectorScore) && vectorScore >= 0 && vectorScore <= 1 && Number.isFinite(factor) && factor > 0) {
        if (vectorScore === 0 || vectorScore === 1) return vectorScore;
        return (vectorScore * factor) / ((1 - vectorScore) + (vectorScore * factor));
    }

    return Math.min(1, Math.max(0, score));
}

function provenanceLabel(source: Source) {
    if (source.knowledgeMetadata?.isSynthetic || source.knowledgeMetadata?.sourceType === 'synthetic-demo') {
        return 'synthetic-demo · 非 KERING 内部制度';
    }
    if (source.knowledgeMetadata?.sourceType === 'official-public') {
        return 'official-public · KERING 官网公开资料';
    }
    return source.knowledgeMetadata?.sourceType || 'source type unknown';
}

function ExpandableText({ value, size = 160 }: { value: string; size?: number }) {
    const [open, setOpen] = useState(false);
    const needsExpand = value.length > size;
    if (!needsExpand) return <span>{value}</span>;
    return (
        <span className="rag-expandable-text">
            {open ? value : shortText(value, size)}
            <button type="button" className="rag-expand-toggle" onClick={() => setOpen(v => !v)}>
                {open ? '收起' : '展开'}
            </button>
        </span>
    );
}

function HoverPopoverText({ value }: { value: string }) {
    const tooltipId = useId();
    return (
        <span className="rag-hover-popover" tabIndex={0} aria-describedby={tooltipId}>
            <span className="rag-hover-popover-trigger">{value}</span>
            <span id={tooltipId} className="rag-hover-popover-content" role="tooltip">{value}</span>
        </span>
    );
}

export function RagDebugPanel({ query, sources, externalSources = [], externalStatus = null, ragRuntime, retrievalView, filteredChunks, diagnostics }: Props) {
    const topK = diagnostics?.retrieval?.requestedTopK || Math.max(sources.length, 5);
    const externalBaseIndex = sources.length;
    const entitiesText = diagnostics?.retrieval?.entities?.join(' / ') || 'none';
    const effectiveScopes = diagnostics?.retrieval?.effectiveScopes || [];
    const displayedExternalStatus: ExternalStatus = externalStatus || diagnostics?.externalStatus || {
        status: 'not-run',
        enabled: false,
        configured: false,
        fetched: 0,
        accepted: 0,
        skipped: 0
    };

    const filteredReason = (() => {
        if (sources.length) return '已按当前 Skill scope、topK 和 score 阈值返回候选 chunk。';
        if (!diagnostics) return '未命中引用；请检查知识域、向量索引或上传文档。';
        if ((diagnostics.chunkCount || 0) === 0) {
            return `未命中引用：当前租户知识库为空（${diagnostics.documentCount || 0} 文档 / ${diagnostics.chunkCount || 0} chunk）。系统已内置示例知识库，请前往「知识库」导入模板或重新部署以触发自动 seed。`;
        }
        if (!diagnostics.vectorSearchReady) {
            return `未命中引用：向量索引异常或未就绪（chunk=${diagnostics.chunkCount}）。请检查 Atlas 向量索引配置：${diagnostics.error || 'unknown'}`;
        }
        return diagnostics.outcome?.message || diagnostics.retrieval?.outcome?.message || `知识缺口：知识库有 ${diagnostics.chunkCount} 个 chunk，但当前 query 与 scope 组合没有足够可靠的证据。`;
    })();

    return (
        <section className="rag-debug-panel">
            <div className="rag-debug-head">
                <div>
                    <span>{retrievalView.live ? 'Live Retrieval Debug' : 'Fallback Retrieval Debug'}</span>
                    <strong>{retrievalView.backend}</strong>
                </div>
                <Database size={18} />
            </div>
            <div className="rag-debug-grid">
                <article>
                    <em>query</em>
                    <strong className="rag-debug-overflow-field"><HoverPopoverText value={query || '等待用户输入需求'} /></strong>
                </article>
                <article>
                    <em>query plan</em>
                    <strong>{diagnostics?.retrieval?.knowledgeDomain || 'general'} · {diagnostics?.retrieval?.taskModeId || 'no-task-mode'}</strong>
                </article>
                <article className="rag-debug-scope-card">
                    <em>effective knowledge scope</em>
                    <div className="rag-debug-scope-list">
                        {effectiveScopes.map((scope) => <span key={scope}>{scope}</span>)}
                        {!effectiveScopes.length ? <span>minimal-context</span> : null}
                    </div>
                    <small>source: {diagnostics?.retrieval?.scopeSource || 'runtime-effective-filter'}</small>
                </article>
                <article>
                    <em>entities</em>
                    <strong className="rag-debug-overflow-field"><HoverPopoverText value={entitiesText} /></strong>
                </article>
                <article>
                    <em>topK / hits</em>
                    <strong>{topK} / {sources.length}</strong>
                </article>
                <article>
                    <em>index</em>
                    <strong>{ragRuntime?.index || 'not configured'}</strong>
                </article>
                <article>
                    <em>path</em>
                    <strong>{ragRuntime?.vectorPath || 'embedding'}</strong>
                </article>
                <article>
                    <em>rerank</em>
                    <strong>{diagnostics?.retrieval?.queryStrategy || (retrievalView.live ? 'vector score' : 'local score')}</strong>
                </article>
                <article>
                    <em>candidate pool</em>
                    <strong>{diagnostics?.retrieval?.candidateLimit || topK} / {diagnostics?.retrieval?.numCandidates || '-'}</strong>
                </article>
                <article>
                    <em>score semantics</em>
                    <strong>0–1 relevance · not confidence</strong>
                </article>
            </div>
            <div className="rag-debug-note">
                <b>{retrievalView.label}</b>
                <span>{retrievalView.warning || filteredReason}</span>
            </div>
            <div className="rag-debug-results">
                {sources.map((source, index) => (
                    <article id={`src-${index}`} key={source._id || `${source.documentTitle}-${index}`}>
                        <header>
                            <strong>[{index + 1}] {source.documentTitle || 'Untitled source'}</strong>
                            <span>{provenanceLabel(source)} · rerank score {displayRelevance(source).toFixed(4)}</span>
                        </header>
                        <p><ExpandableText value={source.content || ''} size={180} /></p>
                        <footer>
                            <span>{source.retrievalBackend || 'unknown-backend'}</span>
                            <span>{source.sourcePath || 'no-source-path'}</span>
                            <span>rank {source.candidateRank || index + 1}</span>
                            {source.vectorRank ? <span>vector rank {source.vectorRank}</span> : null}
                            {source.vectorScore !== undefined ? <span>vector {Number(source.vectorScore).toFixed(4)}</span> : null}
                            <span>rerank score {displayRelevance(source).toFixed(4)} · not confidence</span>
                            <span>{source.rerankStrategy || 'score-desc'}</span>
                            <span>authority {source.evidenceQuality?.authority || source.knowledgeMetadata?.authorityLevel || 'unknown'}</span>
                            <span>version {source.knowledgeMetadata?.version || 'unknown'} · effective {source.knowledgeMetadata?.effectiveAt?.slice(0, 10) || 'unknown'}</span>
                            <span>{source.filterReason || 'passed current retrieval filters'}</span>
                        </footer>
                    </article>
                ))}
                {!sources.length ? <div className="runtime-empty">运行后展示 query、chunk、score、citation 和过滤原因。</div> : null}
                <div className="rag-debug-external">
                        <div className="rag-debug-external-head">
                            <Globe size={15} />
                            <strong>外部在线证据（{externalSources.length}）</strong>
                            <span>{displayedExternalStatus.status || 'ok'} · 抓取 {displayedExternalStatus.fetched ?? 0} · 采用 {displayedExternalStatus.accepted ?? 0} · 跳过 {displayedExternalStatus.skipped ?? 0}{displayedExternalStatus.latencyMs !== undefined ? ` · ${displayedExternalStatus.latencyMs}ms` : ''}</span>
                        </div>
                        {!externalSources.length ? (
                            <div className="rag-debug-external-empty">
                                {displayedExternalStatus.status === 'not-run'
                                    ? '当前 Run 尚未执行或未记录外部在线检索状态。新 Run 将在此展示 disabled、timeout、no-hits 或已采用证据。'
                                    : displayedExternalStatus.status === 'disabled' || displayedExternalStatus.enabled === false
                                    ? '外部在线检索已关闭：请在服务端私有环境变量设置 EXTERNAL_SEARCH_ENABLED=true，并配置 Provider、HTTPS Endpoint 与 API Key。'
                                    : displayedExternalStatus.status === 'not-configured' || displayedExternalStatus.configured === false
                                        ? `外部在线检索尚未完成配置：${displayedExternalStatus.error || '缺少 Provider、HTTPS Endpoint 或服务端 API Key'}。`
                                    : (displayedExternalStatus.status === 'not-eligible' || displayedExternalStatus.status === 'scope-not-eligible')
                                        ? '当前 Task Mode / scope 不在外部检索白名单内，仅使用本地 Atlas 知识库。'
                                        : displayedExternalStatus.status === 'no-hits'
                                            ? '外部检索已执行，未命中白名单内的相关结果。'
                                            : displayedExternalStatus.status === 'error' || displayedExternalStatus.status === 'provider-error'
                                                ? `外部检索失败：${displayedExternalStatus.error || 'unknown'}`
                                                : displayedExternalStatus.status === 'timeout'
                                                    ? `外部检索超过 ${displayedExternalStatus.timeoutMs || 10000}ms，已降级为仅使用本地 Atlas。`
                                                    : displayedExternalStatus.status === 'circuit-open'
                                                        ? '外部检索供应商连续失败，熔断器已开启；当前 Run 仅使用本地 Atlas。'
                                                        : displayedExternalStatus.status === 'rate-limited'
                                                            ? '外部检索达到并发上限；当前 Run 仅使用本地 Atlas。'
                                                            : displayedExternalStatus.status === 'skipped'
                                                        ? '外部检索被跳过。'
                                                        : '外部检索未返回结果。'}
                            </div>
                        ) : null}
                        {externalSources.map((source, index) => {
                            const citationNumber = externalBaseIndex + index + 1;
                            return (
                                <article id={`src-${externalBaseIndex + index}`} key={source.sourceUrl || `${source.documentTitle}-${index}`} className="rag-external-card">
                                    <header>
                                        <strong>[{citationNumber}] {source.documentTitle || '外部来源'}</strong>
                                        <span className="rag-external-authority">权威 L{source.authorityLevel ?? '-'} · {source.authorityLabel || '未验证'}</span>
                                    </header>
                                    <p><ExpandableText value={source.content || ''} size={180} /></p>
                                    <footer>
                                        {source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} />{source.sourceUrl}</a> : null}
                                        <span>抓取 {source.crawlTime ? new Date(source.crawlTime).toLocaleString('zh-CN', { hour12: false }) : '-'}</span>
                                        {source.publishedAt ? <span>发布 {new Date(source.publishedAt).toLocaleDateString('zh-CN')}</span> : null}
                                        <span>段落 {source.paragraphs?.length ?? 0}</span>
                                        {source.requiresHumanReview ? <span className="rag-external-review"><ShieldAlert size={12} />需人工确认</span> : null}
                                        <span className="rag-external-nofile">外部证据·不可直接执行</span>
                                    </footer>
                                </article>
                            );
                        })}
                </div>
                <div className="rag-debug-filtered">
                    <details>
                        <summary>被过滤来源（{filteredChunks?.length || 0}）</summary>
                        {(filteredChunks || []).map((chunk, index) => (
                            <article key={chunk.id || index}>
                                <header>
                                    <strong>{chunk.title || 'Untitled'}</strong>
                                    <span>score {Number(chunk.score || 0).toFixed(4)}</span>
                                </header>
                                <p>{chunk.reason}</p>
                            </article>
                        ))}
                        {!filteredChunks?.length ? <div className="runtime-empty">无被过滤来源。</div> : null}
                    </details>
                </div>
            </div>
        </section>
    );
}
