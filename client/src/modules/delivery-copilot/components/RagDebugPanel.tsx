import { useState } from 'react';
import { Database } from 'lucide-react';
import type { FilteredChunk } from '../types';

type Source = {
    _id?: string;
    documentTitle?: string;
    content?: string;
    score?: number;
    candidateRank?: number;
    vectorRank?: number;
    rerankScore?: number;
    rerankStrategy?: string;
    filterReason?: string;
    retrievalBackend?: string;
    sourcePath?: string;
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
    retrieval?: {
        query?: string;
        queryStrategy?: string;
        requestedTopK?: number;
        candidateLimit?: number;
        numCandidates?: number;
    };
};

type Props = {
    query: string;
    sources: Source[];
    ragRuntime?: RagRuntime;
    retrievalView: RetrievalView;
    filteredChunks?: FilteredChunk[];
    diagnostics?: Diagnostics;
};

function shortText(value = '', size = 160) {
    return value.length > size ? `${value.slice(0, size)}...` : value;
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

export function RagDebugPanel({ query, sources, ragRuntime, retrievalView, filteredChunks, diagnostics }: Props) {
    const topK = diagnostics?.retrieval?.requestedTopK || Math.max(sources.length, 5);

    const filteredReason = (() => {
        if (sources.length) return '已按当前 Skill scope、topK 和 score 阈值返回候选 chunk。';
        if (!diagnostics) return '未命中引用；请检查知识域、向量索引或上传文档。';
        if ((diagnostics.chunkCount || 0) === 0) {
            return `未命中引用：当前租户知识库为空（${diagnostics.documentCount || 0} 文档 / ${diagnostics.chunkCount || 0} chunk）。系统已内置示例知识库，请前往「知识库」导入模板或重新部署以触发自动 seed。`;
        }
        if (!diagnostics.vectorSearchReady) {
            return `未命中引用：向量索引异常或未就绪（chunk=${diagnostics.chunkCount}）。请检查 Atlas 向量索引配置：${diagnostics.error || 'unknown'}`;
        }
        return `未命中引用：知识库有 ${diagnostics.chunkCount} 个 chunk，但当前 query 与 scope 组合未召回内容。可尝试扩大 scope 或上传更相关文档。`;
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
                            <span>score {Number(source.score || 0).toFixed(4)}</span>
                        </header>
                        <p><ExpandableText value={source.content || ''} size={180} /></p>
                        <footer>
                            <span>{source.retrievalBackend || 'unknown-backend'}</span>
                            <span>{source.sourcePath || 'no-source-path'}</span>
                            <span>rank {source.candidateRank || index + 1}</span>
                            {source.vectorRank ? <span>vector rank {source.vectorRank}</span> : null}
                            <span>rerank {Number(source.rerankScore ?? source.score ?? 0).toFixed(4)}</span>
                            <span>{source.rerankStrategy || 'score-desc'}</span>
                            <span>{source.filterReason || 'passed current retrieval filters'}</span>
                        </footer>
                    </article>
                ))}
                {!sources.length ? <div className="runtime-empty">运行后展示 query、chunk、score、citation 和过滤原因。</div> : null}
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
