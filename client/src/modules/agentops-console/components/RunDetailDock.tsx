import { AlertTriangle, CheckCircle2, Database, GitBranch, RotateCcw, Workflow } from 'lucide-react';
import type { AgentRun } from '../types';
import { formatTime } from '../utils';
import { FileBadge, ShieldValue } from './Common';

type Props = {
  activeRun?: AgentRun;
  controlNote: string;
  onControlNoteChange: (value: string) => void;
  onReview: (action: string) => void;
};

export function RunDetailDock({ activeRun, controlNote, onControlNoteChange, onReview }: Props) {
  return (
    <aside className="panel ops-detail-dock">
      <div className="section-head">
        <div>
          <h2>Run Detail</h2>
          <p>审批记录、失败回放和产物留档。</p>
        </div>
        <Workflow size={20} />
      </div>
      <textarea value={controlNote} onChange={(event) => onControlNoteChange(event.target.value)} />
      <div className="ops-review-actions">
        <button className="primary-button" onClick={() => onReview('confirm')} disabled={!activeRun}><CheckCircle2 size={14} />确认</button>
        <button className="secondary-button" onClick={() => onReview('revise')} disabled={!activeRun}>修改</button>
        <button className="danger-button" onClick={() => onReview('reject')} disabled={!activeRun}><AlertTriangle size={14} />拒绝</button>
      </div>
      <div className="ops-detail-block">
        <strong>Artifacts</strong>
        {(activeRun?.artifacts || []).map((artifact) => (
          <article key={artifact.id}>
            <FileBadge title={artifact.title} />
            <span>{artifact.type} · {artifact.status} · v{artifact.version || 1}</span>
          </article>
        ))}
      </div>
      <div className="ops-detail-block">
        <strong>Sources</strong>
        {(activeRun?.sources || []).slice(0, 5).map((source) => (
          <article key={source._id}>
            <Database size={14} />
            <span>{source.documentTitle} · {Number(source.score || 0).toFixed(4)}</span>
          </article>
        ))}
      </div>
      <div className="ops-detail-block">
        <strong>State Transitions</strong>
        {(activeRun?.stateTransitions || []).slice(-6).reverse().map((transition) => (
          <article key={transition.id}>
            <GitBranch size={14} />
            <span>{transition.from} {'->'} {transition.to}</span>
            <em>{formatTime(transition.at)}</em>
          </article>
        ))}
        {!activeRun?.stateTransitions?.length ? <p>暂无状态机流转记录。</p> : null}
      </div>
      <div className="ops-detail-block">
        <strong>Review / Control History</strong>
        {(activeRun?.reviewHistory || []).slice(0, 4).map((item, index) => (
          <article key={item._id || `${item.action}-${index}`}>
            <CheckCircle2 size={14} />
            <span>{item.action} {'->'} {item.nextStatus || 'reviewed'}</span>
            <em>{item.note || 'no note'}</em>
          </article>
        ))}
        {(activeRun?.controlHistory || []).slice(0, 4).map((item) => (
          <article key={item.id}>
            <RotateCcw size={14} />
            <span>{item.action} {'->'} {item.status}</span>
            <em>{item.reason || 'no reason'}</em>
          </article>
        ))}
        {!activeRun?.reviewHistory?.length && !activeRun?.controlHistory?.length ? <p>暂无审批或控制历史。</p> : null}
      </div>
      <div className="ops-detail-block">
        <strong>Quality Checks</strong>
        <article>
          <ShieldValue score={activeRun?.quality?.score ?? activeRun?.evalResult?.score} />
          <span>{activeRun?.quality?.passed || activeRun?.evalResult?.passed || 0}/{activeRun?.quality?.total || activeRun?.evalResult?.total || 0} checks · {activeRun?.quality?.verdict || activeRun?.evalResult?.verdict || 'not assessed'}</span>
        </article>
      </div>
      <div className="ops-detail-block">
        <strong>Audit Log</strong>
        {(activeRun?.logs || []).slice(-8).reverse().map((log) => (
          <article key={log.id}>
            <span>{log.level}</span>
            <p>{log.message}</p>
            <em>{formatTime(log.at)}</em>
          </article>
        ))}
      </div>
    </aside>
  );
}
