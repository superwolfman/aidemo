import { Clock3, TerminalSquare } from 'lucide-react';
import type { TraceStep } from '../types';
import { formatJson } from '../utils';

type Props = {
  trace: TraceStep[];
  activeTrace?: TraceStep;
  onSelectTrace: (id: string) => void;
};

export function TraceAuditPanel({ trace, activeTrace, onSelectTrace }: Props) {
  return (
    <section className="ops-lower-grid">
      <article className="panel ops-trace-panel">
        <div className="section-head">
          <div>
            <h2>Trace Timeline</h2>
            <p>默认展示步骤，点击节点查看输入输出。</p>
          </div>
          <Clock3 size={18} />
        </div>
        <div className="ops-trace-list">
          {trace.map((item) => (
            <button key={item.id} className={activeTrace?.id === item.id ? 'active' : ''} onClick={() => onSelectTrace(item.id)}>
              <span className={`ops-dot ${item.status}`} />
              <strong>{item.name}</strong>
              <em>{item.durationMs || 0}ms · {item.tokenUsage || 0} tokens</em>
            </button>
          ))}
          {!trace.length ? <div className="runtime-empty">暂无 Trace。</div> : null}
        </div>
      </article>

      <article className="panel ops-audit-panel">
        <div className="section-head">
          <div>
            <h2>Tool Call Audit</h2>
            <p>工具调用、错误、token 和审计输入输出。</p>
          </div>
          <TerminalSquare size={18} />
        </div>
        {activeTrace ? (
          <div className="ops-node-detail">
            <header>
              <strong>{activeTrace.name}</strong>
              <span>{activeTrace.status}</span>
            </header>
            <div className="ops-node-meta">
              <em>{activeTrace.durationMs || 0}ms</em>
              <em>{activeTrace.tokenUsage || 0} tokens</em>
              <em>{activeTrace.tool || 'runtime'}</em>
            </div>
            <pre>{formatJson({ input: activeTrace.input, output: activeTrace.output, error: activeTrace.error })}</pre>
          </div>
        ) : <div className="runtime-empty">选择 Trace 节点查看详情。</div>}
      </article>
    </section>
  );
}
