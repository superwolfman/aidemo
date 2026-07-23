import { GitBranch } from 'lucide-react';
import type { TraceStep } from '../types';

type Props = {
  stateSteps: TraceStep[];
  activeTrace?: TraceStep;
  trendPath: string;
  onSelectTrace: (id: string) => void;
};

export function StateMachinePanel({ stateSteps, activeTrace, trendPath, onSelectTrace }: Props) {
  return (
    <section className="panel ops-graph-panel">
      <div className="section-head">
        <div>
          <h2>Agent State Machine</h2>
          <p>展示 Agent 从意图识别到人工确认的真实状态路径。</p>
        </div>
        <GitBranch size={20} />
      </div>
      <div className="ops-state-rail">
        {stateSteps.map((step, index) => (
          <button key={step.id} className={`${activeTrace?.id === step.id ? 'active' : ''} ${step.status}`} onClick={() => onSelectTrace(step.id)}>
            <em>{String(index + 1).padStart(2, '0')}</em>
            <strong>{step.name}</strong>
            <span>{step.status}</span>
          </button>
        ))}
      </div>
      <svg className="ops-sparkline" viewBox="0 0 280 72" aria-hidden="true">
        <polyline points={trendPath} fill="none" stroke="#0f766e" strokeWidth="4" strokeLinecap="round" />
      </svg>
    </section>
  );
}
