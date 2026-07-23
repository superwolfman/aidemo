import { CheckCircle2, ShieldCheck } from 'lucide-react';
import type { AgentRun, Artifact, ArtifactSummaryItem } from '../types';

type Props = {
  activeRun: AgentRun | null;
  activeArtifact?: Artifact;
  artifactSummary: ArtifactSummaryItem[];
  onSelectArtifact: (artifact: Artifact) => void;
  onConfirmArtifact: () => void;
};

export function ApprovalPanel({ activeRun, activeArtifact, artifactSummary, onSelectArtifact, onConfirmArtifact }: Props) {
  const confirmedCount = artifactSummary.filter((item) => item.confirmed).length;
  const readyCount = artifactSummary.filter((item) => item.done).length;
  const latestApproval = activeArtifact?.approvals?.[0];

  return (
    <section className="delivery-approval-panel panel">
      <div className="section-head">
        <div>
          <h3>人工确认</h3>
          <p>高风险交付物进入人工确认后才算交付闭环，确认记录会写回 Run 和 Artifact。</p>
        </div>
        <ShieldCheck size={18} />
      </div>
      <div className="approval-score">
        <article>
          <strong>{readyCount}/{artifactSummary.length}</strong>
          <span>ready</span>
        </article>
        <article>
          <strong>{confirmedCount}</strong>
          <span>confirmed</span>
        </article>
        <article>
          <strong>{activeRun?.status || 'idle'}</strong>
          <span>run status</span>
        </article>
      </div>
      <div className="approval-artifact-list">
        {artifactSummary.map((item) => (
          <button
            key={item.type}
            type="button"
            disabled={!item.artifact}
            className={activeArtifact?.id === item.artifact?.id ? 'active' : ''}
            onClick={() => item.artifact && onSelectArtifact(item.artifact)}
          >
            <CheckCircle2 size={14} />
            <span>{item.title}</span>
            <em>{item.confirmed ? 'confirmed' : item.done ? 'ready' : 'waiting'}</em>
          </button>
        ))}
      </div>
      <div className="approval-current">
        <strong>{activeArtifact?.title || '请选择一个交付物'}</strong>
        <p>{latestApproval ? `${latestApproval.action} · ${latestApproval.note || '无备注'}` : '确认后会生成审批记录，可在 AgentOps 回查。'}</p>
        <button type="button" className="primary-button" disabled={!activeArtifact || activeArtifact.reviewStatus === 'approved'} onClick={onConfirmArtifact}>
          确认当前交付物
        </button>
      </div>
    </section>
  );
}
