import { useState } from 'react';
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
    retrieval?: {
        query?: string;
        originalQuery?: string;
        fullTextQuery?: string;
        entities?: string[];
        knowledgeDomain?: string | null;
        taskModeId?: string | null;
        effectiveScopes?: string[];
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

export function RagDebugPanel({ query, sources, externalSources = [], externalStatus = null, ragRuntime, retrievalView, filteredChunks, diagnostics }: Props) {
    const topK = diagnostics?.retrieval?.requestedTopK || Math.max(sources.length, 5);
    const externalBaseIndex = sources.length;

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
                    <strong><ExpandableText value={query || '等待用户输入需求'} size={80} /></strong>
                </article>
                <article>
                    <em>query plan</em>
                    <strong>{diagnostics?.retrieval?.knowledgeDomain || 'general'} · {diagnostics?.retrieval?.taskModeId || 'no-task-mode'}</strong>
                </article>
                <article>
                    <em>entities</em>
                    <strong>{diagnostics?.retrieval?.entities?.join(' / ') || 'none'}</strong>
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
                            <span>relevance {displayRelevance(source).toFixed(4)}</span>
                        </header>
                        <p><ExpandableText value={source.content || ''} size={180} /></p>
                        <footer>
                            <span>{source.retrievalBackend || 'unknown-backend'}</span>
                            <span>{source.sourcePath || 'no-source-path'}</span>
                            <span>rank {source.candidateRank || index + 1}</span>
                            {source.vectorRank ? <span>vector rank {source.vectorRank}</span> : null}
                            {source.vectorScore !== undefined ? <span>vector {Number(source.vectorScore).toFixed(4)}</span> : null}
                            <span>rerank relevance {displayRelevance(source).toFixed(4)}</span>
                            <span>{source.rerankStrategy || 'score-desc'}</span>
                            <span>{source.filterReason || 'passed current retrieval filters'}</span>
                        </footer>
                    </article>
                ))}
                {!sources.length ? <div className="runtime-empty">运行后展示 query、chunk、score、citation 和过滤原因。</div> : null}
                {externalStatus ? (
                    <div className="rag-debug-external">
                        <div className="rag-debug-external-head">
                            <Globe size={15} />
                            <strong>外部在线证据（{externalSources.length}）</strong>
                            <span>{externalStatus.status || 'ok'} · 抓取 {externalStatus.fetched ?? 0} · 采用 {externalStatus.accepted ?? 0} · 跳过 {externalStatus.skipped ?? 0}</span>
                        </div>
                        {!externalSources.length ? (
                            <div className="rag-debug-external-empty">
                                {externalStatus.status === 'disabled' || externalStatus.enabled === false
                                    ? '外部在线检索已关闭：请在服务端私有环境变量设置 EXTERNAL_SEARCH_ENABLED=true，并配置 Provider、HTTPS Endpoint 与 API Key。'
                                    : externalStatus.status === 'not-configured' || externalStatus.configured === false
                                        ? `外部在线检索尚未完成配置：${externalStatus.error || '缺少 Provider、HTTPS Endpoint 或服务端 API Key'}。`
                                    : (externalStatus.status === 'not-eligible' || externalStatus.status === 'scope-not-eligible')
                                        ? '当前 Task Mode / scope 不在外部检索白名单内，仅使用本地 Atlas 知识库。'
                                        : externalStatus.status === 'no-hits'
                                            ? '外部检索已执行，未命中白名单内的相关结果。'
                                            : externalStatus.status === 'error' || externalStatus.status === 'provider-error'
                                                ? `外部检索失败：${externalStatus.error || 'unknown'}`
                                                : externalStatus.status === 'timeout'
                                                    ? '外部检索超时，已降级为仅使用本地 Atlas。'
                                                    : externalStatus.status === 'circuit-open'
                                                        ? '外部检索供应商连续失败，熔断器已开启；当前 Run 仅使用本地 Atlas。'
                                                        : externalStatus.status === 'rate-limited'
                                                            ? '外部检索达到并发上限；当前 Run 仅使用本地 Atlas。'
                                                            : externalStatus.status === 'skipped'
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
                ) : null}
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
