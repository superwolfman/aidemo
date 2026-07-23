import { Database } from 'lucide-react';

type Source = {
  _id?: string;
  documentTitle?: string;
  content?: string;
  score?: number;
  candidateRank?: number;
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

type Props = {
  query: string;
  sources: Source[];
  ragRuntime?: RagRuntime;
  retrievalView: RetrievalView;
};

function shortText(value = '', size = 160) {
  return value.length > size ? `${value.slice(0, size)}...` : value;
}

export function RagDebugPanel({ query, sources, ragRuntime, retrievalView }: Props) {
  const filteredReason = sources.length
    ? '已按当前 Skill scope、topK 和 score 阈值返回候选 chunk。'
    : '未命中引用；请检查知识域、向量索引或上传文档。';
  const topK = Math.max(sources.length, 5);

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
          <strong>{shortText(query || '等待用户输入需求', 80)}</strong>
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
          <strong>{retrievalView.live ? 'vector score' : 'local score'}</strong>
        </article>
      </div>
      <div className="rag-debug-note">
        <b>{retrievalView.label}</b>
        <span>{retrievalView.warning || filteredReason}</span>
      </div>
      <div className="rag-debug-results">
        {sources.map((source, index) => (
          <article key={source._id || `${source.documentTitle}-${index}`}>
            <header>
              <strong>[{index + 1}] {source.documentTitle || 'Untitled source'}</strong>
              <span>score {Number(source.score || 0).toFixed(4)}</span>
            </header>
            <p>{shortText(source.content || '', 180)}</p>
            <footer>
              <span>{source.retrievalBackend || 'unknown-backend'}</span>
              <span>{source.sourcePath || 'no-source-path'}</span>
              <span>rank {source.candidateRank || index + 1}</span>
              <span>rerank {Number(source.rerankScore ?? source.score ?? 0).toFixed(4)}</span>
              <span>{source.rerankStrategy || 'score-desc'}</span>
              <span>{source.filterReason || 'passed current retrieval filters'}</span>
            </footer>
          </article>
        ))}
        {!sources.length ? <div className="runtime-empty">运行后展示 query、chunk、score、citation 和过滤原因。</div> : null}
      </div>
    </section>
  );
}
