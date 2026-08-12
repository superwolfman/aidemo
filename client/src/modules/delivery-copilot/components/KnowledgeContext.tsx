import { Database, ShieldCheck } from 'lucide-react';
import { RagDebugPanel } from './RagDebugPanel';
import type { FilteredChunk, RagRuntime, RetrievalView, Source, TraceStep } from '../types';

type KnowledgeContextProps = {
  ragLive: boolean;
  ragRuntime?: RagRuntime;
  retrievalView: RetrievalView;
  requirement: string;
  sources: Source[];
  externalSources?: any[];
  externalStatus?: any;
  filteredChunks?: FilteredChunk[];
  diagnostics?: any;
  trace: TraceStep[];
};

export function KnowledgeContext({
  ragLive,
  ragRuntime,
  retrievalView,
  requirement,
  sources,
  externalSources,
  externalStatus,
  filteredChunks,
  diagnostics,
  trace
}: KnowledgeContextProps) {
  return (
    <aside className="panel delivery-context">
      <div className="section-head">
        <div>
          <h2>引用与确认</h2>
          <p>降低幻觉，保留人工决策。</p>
        </div>
        <Database size={20} />
      </div>
      <div className={`delivery-vector-health ${ragLive ? 'live' : 'fallback'}`}>
        <div>
          <strong>{ragLive ? 'Live Vector Store' : 'Fallback Retrieval'}</strong>
          <span>{retrievalView.label}</span>
        </div>
        <p>
          {ragLive
            ? `Index ${ragRuntime?.index || 'default'} · Path ${ragRuntime?.vectorPath || 'embedding'} · ${ragRuntime?.dimensions || 0} dims`
            : (retrievalView.warning || ragRuntime?.error || '当前未启用真实向量库，使用 local deterministic embedding。')}
        </p>
        {ragRuntime?.embeddingProvider ? (
          <p>
            <small className={ragRuntime.embeddingProvider.startsWith('local-fallback') ? 'env-warn' : 'env-ok'}>
              embedding provider: {ragRuntime.embeddingProvider}
            </small>
          </p>
        ) : null}
        <em>{retrievalView.backend} · {ragRuntime?.connection || (ragRuntime?.connected ? 'connected' : 'not connected')}</em>
      </div>
      <RagDebugPanel
        query={diagnostics?.retrieval?.query || requirement}
        sources={sources}
        externalSources={externalSources}
        externalStatus={externalStatus}
        ragRuntime={ragRuntime}
        retrievalView={retrievalView}
        filteredChunks={filteredChunks}
        diagnostics={diagnostics}
      />
      <div className="delivery-review-box">
        <ShieldCheck size={18} />
        <div>
          <strong>人工确认节点</strong>
          <p>PRD、API、任务拆解和风险项生成后，进入人工确认再继续交付。</p>
        </div>
      </div>
      <div className="delivery-mini-trace">
        <strong>真实 Trace</strong>
        {trace.slice(0, 6).map((item, index) => (
          <span key={item.id ? `${item.id}-${index}` : `trace-${index}`}>{item.name} · {item.status} · {item.durationMs || 0}ms</span>
        ))}
        {!trace.length ? <p>运行后展示 Agent 状态流转。</p> : null}
      </div>
    </aside>
  );
}
