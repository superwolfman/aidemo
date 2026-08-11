import { Pause, Play, RefreshCw, RotateCcw, Send, TerminalSquare } from 'lucide-react';
import type { AgentRun, Capability } from '../types';
import { scopeOptions } from '../utils';

type Props = {
  command: string;
  selectedAgentId: string;
  selectedAgent?: Capability;
  capabilities: Capability[];
  selectedScopes: string[];
  selectedScopeLabels: string[];
  running: boolean;
  sessionReady: boolean;
  readOnlyControls?: boolean;
  activeRun?: AgentRun;
  onCommandChange: (value: string) => void;
  onAgentChange: (id: string) => void;
  onToggleScope: (id: string) => void;
  onRun: () => void;
  onRefresh: () => void;
  onControl: (action: string) => void;
  onRerun: () => void;
};

export function CommandCenter({
  command,
  selectedAgentId,
  selectedAgent,
  capabilities,
  selectedScopes,
  selectedScopeLabels,
  running,
  sessionReady,
  readOnlyControls = false,
  activeRun,
  onCommandChange,
  onAgentChange,
  onToggleScope,
  onRun,
  onRefresh,
  onControl,
  onRerun
}: Props) {
  return (
    <section className="ops-command-center panel">
      <div className="section-head">
        <div>
          <h2>Command Center</h2>
          <p>输入指令、选择 Agent/Skill、限定知识范围，并对真实 Run 执行暂停、恢复、回滚和重放。</p>
        </div>
        <TerminalSquare size={20} />
      </div>
      <div className="ops-command-layout">
        <label className="ops-command-input">
          <span>Task Instruction</span>
          <textarea
            value={command}
            placeholder="输入新的 Agent 指令；也可以从 Run Registry 选择历史运行进行审计。"
            onChange={(event) => onCommandChange(event.target.value)}
          />
        </label>
        <div className="ops-command-config">
          <div className="ops-config-block">
            <div className="ops-config-title">
              <span>Agent / Skill</span>
              <em>决定意图识别、允许工具、输出约束和审批策略</em>
            </div>
            <div className="ops-agent-grid">
              {capabilities.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={selectedAgentId === item.id ? 'active' : ''}
                  onClick={() => onAgentChange(item.id)}
                >
                  <strong>{item.name}</strong>
                  <p>{item.description}</p>
                  <span>{item.tools.length} tools · {item.intents.length} intents</span>
                </button>
              ))}
            </div>
          </div>
          <div className="ops-scope-panel">
            <div className="ops-config-title">
              <span>Knowledge Scope</span>
              <em>限制 RAG 检索域，影响引用来源、Tool Guardrail 和 Trace 审计</em>
            </div>
            <div className="ops-scope-row">
              {scopeOptions.map((scope) => (
                <button key={scope.id} type="button" className={selectedScopes.includes(scope.id) ? 'active' : ''} onClick={() => onToggleScope(scope.id)}>
                  {scope.label}
                </button>
              ))}
            </div>
            <div className="ops-scope-impact">
              <strong>{selectedScopeLabels.length || 0}/{scopeOptions.length} scopes</strong>
              <p>{selectedScopeLabels.length ? `本次 Run 只会检索：${selectedScopeLabels.join('、')}` : '未选择知识域时，RAG 将退化为最小上下文检索。'}</p>
            </div>
          </div>
        </div>
        <div className="ops-command-control">
          <strong>Run Control</strong>
          <span>{readOnlyControls
            ? '受限演示账号可创建限额 Demo Run 并查看运行证据，不可暂停、恢复、回滚或重放。'
            : (running ? 'Agent 正在执行，Trace 会持续写入 Run Registry。' : `准备运行 ${selectedAgent?.name || 'Agent'}，或治理当前选中的 Run。`)}</span>
          <div className="ops-command-actions">
            <button className="primary-button" onClick={onRun} disabled={!sessionReady || running || !command.trim()}><Send size={15} />{running ? '运行中' : '运行 Agent'}</button>
            <button className="secondary-button" onClick={onRefresh}><RefreshCw size={15} />刷新</button>
            <button className="secondary-button" title={readOnlyControls ? '受限演示账号不可暂停 Run' : undefined} onClick={() => onControl('pause')} disabled={!activeRun || readOnlyControls}><Pause size={15} />暂停</button>
            <button className="secondary-button" title={readOnlyControls ? '受限演示账号不可恢复 Run' : undefined} onClick={() => onControl('resume')} disabled={!activeRun || readOnlyControls}><Play size={15} />恢复</button>
            <button className="secondary-button" title={readOnlyControls ? '受限演示账号不可回滚 Run' : undefined} onClick={() => onControl('rollback')} disabled={!activeRun || readOnlyControls}><RotateCcw size={15} />回滚</button>
            <button className="secondary-button" title={readOnlyControls ? '受限演示账号不可重放 Run' : undefined} onClick={onRerun} disabled={!activeRun || running || readOnlyControls}><RefreshCw size={15} />重放</button>
          </div>
        </div>
      </div>
    </section>
  );
}
