import { Pause, RefreshCw, Send, Sparkles } from 'lucide-react';
import type { DeliveryTaskMode, EvalCase } from '../types';

type SkillSelectorProps = {
  taskModes: DeliveryTaskMode[];
  taskModeId: string;
  onTaskModeChange: (id: string) => void;
  requirement: string;
  audience: string;
  deadline: string;
  constraints: string;
  onRequirementChange: (value: string) => void;
  onAudienceChange: (value: string) => void;
  onDeadlineChange: (value: string) => void;
  onConstraintsChange: (value: string) => void;
  cases: EvalCase[];
  selectedEvalCaseId: string;
  onRunCase: (item: EvalCase) => void;
  onRunAllCases: () => void;
  running: boolean;
  onRun: () => void;
  onStop: () => void;
  onRerun: () => void;
};

export function SkillSelector({
  taskModes,
  taskModeId,
  onTaskModeChange,
  requirement,
  audience,
  deadline,
  constraints,
  onRequirementChange,
  onAudienceChange,
  onDeadlineChange,
  onConstraintsChange,
  cases,
  selectedEvalCaseId,
  onRunCase,
  onRunAllCases,
  running,
  onRun,
  onStop,
  onRerun
}: SkillSelectorProps) {
  return (
    <aside className="panel delivery-intake">
      <div className="section-head">
        <div>
          <h2>需求输入</h2>
          <p>自然语言主导，结构化约束兜底。</p>
        </div>
        <Sparkles size={20} />
      </div>
      <div className="delivery-mode-board">
        <strong>任务模式</strong>
        {taskModes.map((item) => (
          <button key={item.id} type="button" className={taskModeId === item.id ? 'active' : ''} onClick={() => onTaskModeChange(item.id)}>
            <b>{item.title}</b>
            <span>{item.desc}</span>
          </button>
        ))}
      </div>
      <label>业务需求<textarea value={requirement} onChange={(event) => onRequirementChange(event.target.value)} /></label>
      <div className="delivery-two-fields">
        <label>目标用户<input value={audience} onChange={(event) => onAudienceChange(event.target.value)} /></label>
        <label>交付目标<input value={deadline} onChange={(event) => onDeadlineChange(event.target.value)} /></label>
      </div>
      <label>约束条件<textarea value={constraints} onChange={(event) => onConstraintsChange(event.target.value)} /></label>
      <div className="delivery-actions">
        <button className="primary-button" disabled={running} onClick={onRun}><Send size={15} />生成交付物</button>
        <button className="secondary-button" disabled={!running} onClick={onStop}><Pause size={15} />停止</button>
        <button className="secondary-button" disabled={running} onClick={onRerun}><RefreshCw size={15} />重跑</button>
      </div>

      <div className="delivery-cases">
        <div className="delivery-cases-head">
          <strong>真实 Eval Cases</strong>
          <button type="button" className="text-button" disabled={running || cases.length === 0} onClick={onRunAllCases}>运行全部</button>
        </div>
        {cases.map((item) => (
          <button
            key={item.id}
            type="button"
            className={selectedEvalCaseId === item.id ? 'active' : ''}
            disabled={running}
            onClick={() => onRunCase(item)}
          >
            <b>{item.title}</b>
            <span>{item.expected.join(' / ')}</span>
            <em className={item.lastResult ? (item.lastResult.score === 100 ? 'passed' : 'review') : ''}>
              {item.lastResult ? `${item.lastResult.score}% · ${item.lastResult.passed}/${item.lastResult.total}` : '点击运行'}
            </em>
          </button>
        ))}
      </div>
    </aside>
  );
}
