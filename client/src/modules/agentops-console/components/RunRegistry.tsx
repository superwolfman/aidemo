import { Search } from 'lucide-react';
import type { AgentRun } from '../types';
import { formatTime } from '../utils';

type Props = {
  runs: AgentRun[];
  activeRun?: AgentRun;
  keyword: string;
  filter: string;
  onKeywordChange: (value: string) => void;
  onFilterChange: (value: string) => void;
  onSelectRun: (run: AgentRun) => void;
};

const filters = ['all', 'review_required', 'confirmed', 'failed', 'paused', 'rolled_back'];

export function RunRegistry({ runs, activeRun, keyword, filter, onKeywordChange, onFilterChange, onSelectRun }: Props) {
  return (
    <aside className="panel ops-run-registry">
      <div className="section-head">
        <div>
          <h2>Run Registry</h2>
          <p>按状态、意图、Skill 检索历史运行。</p>
        </div>
        <Search size={18} />
      </div>
      <input value={keyword} onChange={(event) => onKeywordChange(event.target.value)} placeholder="Search prompt / skill / status" />
      <div className="ops-filter-row">
        {filters.map((item) => (
          <button key={item} className={filter === item ? 'active' : ''} onClick={() => onFilterChange(item)}>{item}</button>
        ))}
      </div>
      <div className="ops-run-list">
        {runs.map((run) => (
          <button key={run._id} className={activeRun?._id === run._id ? 'active' : ''} onClick={() => onSelectRun(run)}>
            <strong>{run.intent?.label || 'Agent Run'}</strong>
            <span>{run.status} · {run.selectedSkill?.name || 'Runtime'} · {formatTime(run.createdAt)}</span>
            <p>{run.prompt}</p>
          </button>
        ))}
        {!runs.length ? <div className="runtime-empty">暂无匹配 Run。</div> : null}
      </div>
    </aside>
  );
}
