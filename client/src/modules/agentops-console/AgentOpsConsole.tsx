import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock3, Database, GitBranch, Pause, Play, RefreshCw, RotateCcw, Search, Send, TerminalSquare, Workflow } from 'lucide-react';
import { request, streamRequest } from '../../api/client';
import { Header } from '../../components/ui';

type AgentSession = {
  _id: string;
  title: string;
};

type TraceStep = {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'success' | 'waiting' | 'failed' | 'paused' | 'cancelled' | 'review_required';
  durationMs?: number;
  tokenUsage?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  tool?: string;
  humanRequired?: boolean;
};

type AgentRun = {
  _id: string;
  runId: string;
  status: string;
  prompt: string;
  intent?: { label: string; goal: string; riskLevel: string; confidence?: number; signals?: string[] };
  selectedSkill?: { name: string; tools: string[] };
  plan?: Array<{ id: string; name: string; owner: string; status: string; tool: string; guardrail: string }>;
  sources?: Array<{ _id: string; documentTitle: string; score: number; retrievalBackend?: string; content: string }>;
  artifacts?: Array<{
    id: string;
    title: string;
    type: string;
    status: string;
    version?: number;
    reviewStatus?: string;
    traceStepId?: string;
    sourceRefs?: Array<{ id: string; index: number; title: string; score: number; retrievalBackend?: string }>;
    versions?: Array<{ version: number; status: string; createdAt: string }>;
    approvals?: Array<{ action: string; note?: string; createdAt: string }>;
    exports?: Array<{ id: string; format: string; filename: string; exportedAt: string }>;
  }>;
  trace?: TraceStep[];
  logs?: Array<{ id: string; level: string; message: string; at: string; action?: string }>;
  quality?: {
    score: number;
    passed: number;
    total: number;
    verdict: string;
    checks?: Array<{ key: string; label: string; passed: boolean; value: string }>;
  };
  stateTransitions?: Array<{ id: string; from: string; to: string; label: string; at: string; reason?: string }>;
  reviewHistory?: Array<{ _id?: string; action: string; note?: string; reviewerId?: string; nextStatus?: string; createdAt?: string }>;
  controlHistory?: Array<{ id: string; action: string; status: string; reason?: string; createdAt: string }>;
  evalResult?: { score: number; passed: number; total: number; verdict: string };
  provider?: Record<string, unknown>;
  createdAt?: string;
};

type Capability = {
  id: string;
  name: string;
  description: string;
  intents: string[];
  tools: string[];
};

type Blueprint = {
  capabilities: Capability[];
  runtime: {
    llm: { provider: string; mode: string; model: string; configured: boolean };
    rag: {
      backend?: string;
      retrievalBackend?: string;
      vectorStore: string;
      productionReady: boolean;
      mode?: string;
      error?: string;
      index?: string;
      vectorPath?: string;
      dimensions?: number;
      connection?: string;
      connected?: boolean;
      vectorSearchReady?: boolean;
    };
  };
};

function formatJson(value: unknown) {
  return JSON.stringify(value ?? null, null, 2);
}

function formatTime(value?: string) {
  if (!value) return '--:--:--';
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function buildSparkline(values: number[]) {
  if (!values.length) return '';
  const width = 280;
  const height = 72;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  return values.map((value, index) => {
    const x = Math.round(index * step);
    const y = Math.round(height - (value / max) * 58 - 7);
    return `${x},${y}`;
  }).join(' ');
}

const scopeOptions = [
  { id: 'architecture', label: '架构规范' },
  { id: 'standards', label: '研发规范' },
  { id: 'ai-native', label: 'AI Native' },
  { id: 'frontend', label: '前端交互' },
  { id: 'im', label: 'IM / 会话' },
  { id: 'sdk', label: 'SDK / 质量' }
];

const stateOrder = [
  { id: 'intent', label: '意图理解' },
  { id: 'skill', label: 'Skill 自动选择' },
  { id: 'rag', label: 'RAG 上下文检索' },
  { id: 'tool', label: '工具 / 计划执行' },
  { id: 'llm', label: 'LLM 流式生成' },
  { id: 'review', label: '人工审批' }
];

export default function AgentOpsConsole() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [session, setSession] = useState<AgentSession | null>(null);
  const [activeRunId, setActiveRunId] = useState('');
  const [activeTraceId, setActiveTraceId] = useState('');
  const [filter, setFilter] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [command, setCommand] = useState('为企业内部 AI 产品研发团队建设一个需求到交付 Agent，要求输出 PRD、页面结构、BFF API、测试策略和上线风险。');
  const [selectedAgentId, setSelectedAgentId] = useState('product-delivery-agent');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['architecture', 'standards', 'ai-native', 'frontend']);
  const [controlNote, setControlNote] = useState('运行治理确认：保留审计日志后进入下一步。');
  const [running, setRunning] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'trace' | 'artifacts' | 'raw'>('overview');

  const activeRun = useMemo(() => runs.find((run) => run._id === activeRunId) || runs[0], [activeRunId, runs]);
  const selectedAgent = useMemo(() => blueprint?.capabilities?.find((item) => item.id === selectedAgentId) || blueprint?.capabilities?.[0], [blueprint, selectedAgentId]);
  const ragRuntime = blueprint?.runtime.rag;
  const ragLive = Boolean(ragRuntime?.productionReady || ragRuntime?.vectorSearchReady);
  const trace = useMemo(() => activeRun?.trace || [], [activeRun]);
  const latestTraceById = useMemo(() => {
    const map = new Map<string, TraceStep>();
    trace.forEach((item) => map.set(item.id, item));
    return map;
  }, [trace]);
  const stateSteps = useMemo(() => stateOrder.map((state) => latestTraceById.get(state.id) || {
    id: state.id,
    name: state.label,
    status: 'pending' as const
  }), [latestTraceById]);
  const activeTrace = trace.find((item) => item.id === activeTraceId) || trace[0];
  const selectedScopeLabels = useMemo(() => scopeOptions.filter((scope) => selectedScopes.includes(scope.id)).map((scope) => scope.label), [selectedScopes]);
  const filteredRuns = useMemo(() => runs.filter((run) => {
    const hitStatus = filter === 'all' || run.status === filter;
    const text = [run.prompt, run.status, run.intent?.label, run.selectedSkill?.name].join(' ').toLowerCase();
    return hitStatus && (!keyword.trim() || text.includes(keyword.trim().toLowerCase()));
  }), [filter, keyword, runs]);
  const metrics = useMemo(() => {
    const allTrace = runs.flatMap((run) => run.trace || []);
    const failed = runs.filter((run) => run.status === 'failed' || run.trace?.some((item) => item.status === 'failed')).length;
    const waiting = runs.filter((run) => ['review_required', 'paused', 'waiting'].includes(run.status)).length;
    const latency = allTrace.reduce((sum, item) => sum + (item.durationMs || 0), 0);
    const tokens = allTrace.reduce((sum, item) => sum + (item.tokenUsage || 0), 0);
    const qualityRuns = runs.filter((run) => run.quality);
    const quality = qualityRuns.reduce((sum, run) => sum + (run.quality?.score || 0), 0);
    const confirmed = runs.filter((run) => ['confirmed', 'completed'].includes(run.status)).length;
    return {
      total: runs.length,
      failed,
      waiting,
      confirmed,
      avgLatency: allTrace.length ? Math.round(latency / allTrace.length) : 0,
      tokens,
      assessed: qualityRuns.length,
      avgQuality: qualityRuns.length ? Math.round(quality / qualityRuns.length) : 0
    };
  }, [runs]);
  const trendPath = useMemo(() => buildSparkline(runs.slice(0, 12).reverse().map((run) => (run.trace || []).reduce((sum, item) => sum + (item.durationMs || 0), 0))), [runs]);
  const metricTrends = useMemo(() => {
    const sample = runs.slice(0, 12).reverse();
    return {
      latency: buildSparkline(sample.map((run) => (run.trace || []).reduce((sum, item) => sum + (item.durationMs || 0), 0))),
      tokens: buildSparkline(sample.map((run) => (run.trace || []).reduce((sum, item) => sum + (item.tokenUsage || 0), 0))),
      quality: buildSparkline(sample.map((run) => run.quality?.score || 0))
    };
  }, [runs]);

  const load = useCallback(async () => {
    const [blueprintResult, runResult, sessionResult] = await Promise.all([
      request('/api/agent-studio/blueprint'),
      request('/api/agent-studio/runs'),
      request('/api/agent-studio/sessions')
    ]);
    setBlueprint(blueprintResult);
    setRuns(runResult.runs || []);
    if (sessionResult.sessions?.[0]) {
      setSession(sessionResult.sessions[0]);
    } else {
      const created = await request('/api/agent-studio/sessions', {
        method: 'POST',
        body: JSON.stringify({ title: 'AgentOps Command Center 会话' })
      });
      setSession(created.session);
    }
    const first = runResult.runs?.[0];
    if (first) {
      setActiveRunId((current) => current || first._id);
      setActiveTraceId((current) => current || first.trace?.[0]?.id || '');
    }
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  async function control(action: string) {
    if (!activeRun) return;
    const result = await request(`/api/agent-studio/runs/${activeRun._id}/control`, {
      method: 'POST',
      body: JSON.stringify({ action, reason: controlNote })
    });
    setRuns((items) => items.map((item) => item._id === result.run._id ? result.run : item));
  }

  async function review(action: string) {
    if (!activeRun) return;
    const result = await request(`/api/agent-studio/runs/${activeRun._id}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, note: controlNote })
    });
    setRuns((items) => items.map((item) => item._id === result.run._id ? result.run : item));
  }

  async function runCommand(nextCommand = command) {
    if (!session || running || !nextCommand.trim()) return;
    setRunning(true);
    let draftRun: AgentRun | null = null;
    try {
      await streamRequest(`/api/agent-studio/sessions/${session._id}/runs/stream`, {
        message: nextCommand,
        commandOptions: {
          agentId: selectedAgentId,
          skillId: selectedAgentId,
          scopes: selectedScopes,
          source: 'agentops-command-center'
        }
      }, {
        run_status: (payload) => {
          const payloadRunId = payload.runDbId || payload.runId || 'running';
          if (!draftRun) {
            draftRun = {
              _id: payloadRunId,
              runId: payload.runId || 'running',
              status: payload.status || 'running',
              prompt: nextCommand,
              intent: payload.intent,
              selectedSkill: payload.selectedSkill,
              plan: payload.plan,
              trace: [],
              logs: []
            };
            setRuns((items) => [draftRun as AgentRun, ...items.filter((item) => item._id !== 'running' && item._id !== payloadRunId)]);
            setActiveRunId(draftRun._id);
          } else {
            draftRun = { ...draftRun, _id: payloadRunId, status: payload.status || draftRun.status, intent: payload.intent || draftRun.intent, selectedSkill: payload.selectedSkill || draftRun.selectedSkill, plan: payload.plan || draftRun.plan };
            setRuns((items) => items.map((item) => item._id === draftRun?._id ? draftRun as AgentRun : item));
          }
        },
        trace: (payload) => {
          if (!draftRun) return;
          const nextTrace = [...(draftRun.trace || []).filter((item) => item.id !== payload.id), payload];
          draftRun = { ...draftRun, trace: nextTrace };
          setRuns((items) => items.map((item) => item._id === draftRun?._id ? draftRun as AgentRun : item));
          setActiveTraceId((current) => current || payload.id);
        },
        sources: (payload) => {
          if (!draftRun) return;
          draftRun = { ...draftRun, sources: payload.sources || [] };
          setRuns((items) => items.map((item) => item._id === draftRun?._id ? draftRun as AgentRun : item));
        },
        artifacts: (payload) => {
          if (!draftRun) return;
          draftRun = { ...draftRun, artifacts: payload.artifacts || [] };
          setRuns((items) => items.map((item) => item._id === draftRun?._id ? draftRun as AgentRun : item));
        },
        final: (payload: { run: AgentRun }) => {
          setRuns((items) => [payload.run, ...items.filter((item) => item._id !== 'running' && item._id !== payload.run._id)]);
          setActiveRunId(payload.run._id);
          setActiveTraceId(payload.run.trace?.[0]?.id || '');
        }
      });
    } finally {
      setRunning(false);
      await load();
    }
  }

  function rerunActive() {
    if (activeRun?.prompt) {
      setCommand(activeRun.prompt);
      runCommand(activeRun.prompt).catch(console.error);
    }
  }

  function toggleScope(scopeId: string) {
    setSelectedScopes((items) => {
      if (items.includes(scopeId)) return items.filter((item) => item !== scopeId);
      return [...items, scopeId];
    });
  }

  return (
    <div className="ops-console-page">
      <div className="product-page-kicker">AgentOps Runtime Console</div>
      <Header
        title="AgentOps 控制台"
        desc="面向运行治理：Run Registry、状态机、Trace Timeline、Tool Call Audit、Run Detail、审批记录和失败回放。"
      />

      <section className="ops-runtime-summary panel">
        <div className="ops-runtime-title">
          <span>Current Run</span>
          <h2>{activeRun?.intent?.label || '等待 Agent Run'}</h2>
          <p>{activeRun?.prompt || '这里不负责生产内容，而负责解释 Agent 怎么跑、哪里失败、能否恢复。'}</p>
        </div>
        <div className="ops-runtime-pills">
          <em>{blueprint?.runtime.llm.provider || 'llm'} · {blueprint?.runtime.llm.mode || 'loading'}</em>
          <em className={ragLive ? 'live' : 'fallback'}>
            {ragLive ? 'mongodb-atlas-vector-search live' : `${ragRuntime?.retrievalBackend || ragRuntime?.vectorStore || 'vector'} fallback`}
          </em>
          <em>{activeRun?.status || 'no-run'}</em>
        </div>
      </section>

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
            <textarea value={command} onChange={(event) => setCommand(event.target.value)} />
          </label>
          <div className="ops-command-config">
            <div className="ops-config-block">
              <div className="ops-config-title">
                <span>Agent / Skill</span>
                <em>决定意图识别、允许工具、输出约束和审批策略</em>
              </div>
              <div className="ops-agent-grid">
                {(blueprint?.capabilities || []).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={selectedAgentId === item.id ? 'active' : ''}
                    onClick={() => setSelectedAgentId(item.id)}
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
                  <button key={scope.id} type="button" className={selectedScopes.includes(scope.id) ? 'active' : ''} onClick={() => toggleScope(scope.id)}>
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
            <span>{running ? 'Agent 正在执行，Trace 会持续写入 Run Registry。' : '准备运行新的 Agent Run，或治理当前选中的 Run。'}</span>
            <div className="ops-command-actions">
              <button className="primary-button" onClick={() => runCommand()} disabled={!session || running}><Send size={15} />{running ? '运行中' : '运行 Agent'}</button>
              <button className="secondary-button" onClick={load}><RefreshCw size={15} />刷新</button>
              <button className="secondary-button" onClick={() => control('pause')} disabled={!activeRun}><Pause size={15} />暂停</button>
              <button className="secondary-button" onClick={() => control('resume')} disabled={!activeRun}><Play size={15} />恢复</button>
              <button className="secondary-button" onClick={() => control('rollback')} disabled={!activeRun}><RotateCcw size={15} />回滚</button>
              <button className="secondary-button" onClick={rerunActive} disabled={!activeRun || running}><RefreshCw size={15} />重放</button>
            </div>
          </div>
        </div>
      </section>

      <section className="ops-metrics-grid">
        <article><strong>{metrics.total}</strong><span>Total Runs</span></article>
        <article><strong>{metrics.waiting}</strong><span>Waiting Review</span></article>
        <article><strong>{metrics.failed}</strong><span>Failed</span></article>
        <article><strong>{metrics.avgLatency}ms</strong><span>Avg Latency</span></article>
        <article><strong>{metrics.avgQuality}%</strong><span>Quality</span></article>
      </section>

      <section className="ops-runtime-metrics-panel panel">
        <div className="section-head">
          <div>
            <h2>Runtime Metrics</h2>
            <p>基于真实 Run、Trace 和日志聚合，不使用静态 Mock 指标。</p>
          </div>
          <button
            className="secondary-button compact"
            type="button"
            onClick={() => {
              setActiveTraceId(trace[0]?.id || '');
              setDetailTab('overview');
              setDetailOpen(true);
            }}
          >
            打开 Run Detail
          </button>
        </div>
        <div className="ops-runtime-metric-grid">
          <MetricTrendCard label="Latency Trend" value={`${metrics.avgLatency}ms`} desc={`${metrics.total} runs · ${trace.length} current trace events`} path={metricTrends.latency} />
          <MetricTrendCard label="Token Usage" value={metrics.tokens.toLocaleString('en-US')} desc="Aggregated from trace tokenUsage" path={metricTrends.tokens} tone="blue" />
          <MetricTrendCard label="Run Quality" value={metrics.assessed ? `${metrics.avgQuality}%` : '未评估'} desc={`${metrics.assessed}/${metrics.total} runs have quality score`} path={metricTrends.quality} tone="cyan" />
          <article className="ops-metric-baseline-card">
            <span>Ops Baseline</span>
            <strong>{Math.min(runs.length, 12)} samples</strong>
            <p>等待审批 {metrics.waiting} 个，失败 {metrics.failed} 个，已确认 {metrics.confirmed} 个。</p>
          </article>
        </div>
        <div className="ops-runtime-context-strip">
          <span><Database size={13} />LLM {blueprint?.runtime.llm.provider || 'loading'} · {blueprint?.runtime.llm.mode || 'unknown'} · {blueprint?.runtime.llm.model || 'model loading'}</span>
          <span>
            Vector {ragRuntime?.retrievalBackend || 'local-hash'} · {ragRuntime?.vectorStore || 'retrieval loading'} · {ragRuntime?.index || 'index pending'}
          </span>
          <span>{ragLive ? `Live ${ragRuntime?.vectorPath || 'embedding'} · ${ragRuntime?.dimensions || 0} dims` : (ragRuntime?.error || 'fallback retrieval')}</span>
          <span>Skill {selectedAgent?.name || 'Agent Runtime'}</span>
          <span>Scope {selectedScopeLabels.length}/{scopeOptions.length} · {selectedScopeLabels.join(' / ') || 'minimal context'}</span>
        </div>
      </section>

      <main className="ops-console-layout">
        <aside className="panel ops-run-registry">
          <div className="section-head">
            <div>
              <h2>Run Registry</h2>
              <p>按状态、意图、Skill 检索历史运行。</p>
            </div>
            <Search size={18} />
          </div>
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="Search prompt / skill / status" />
          <div className="ops-filter-row">
            {['all', 'review_required', 'confirmed', 'failed', 'paused', 'rolled_back'].map((item) => (
              <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>
            ))}
          </div>
          <div className="ops-run-list">
            {filteredRuns.map((run) => (
              <button key={run._id} className={activeRun?._id === run._id ? 'active' : ''} onClick={() => { setActiveRunId(run._id); setActiveTraceId(run.trace?.[0]?.id || ''); }}>
                <strong>{run.intent?.label || 'Agent Run'}</strong>
                <span>{run.status} · {run.selectedSkill?.name || 'Runtime'} · {formatTime(run.createdAt)}</span>
                <p>{run.prompt}</p>
              </button>
            ))}
            {!filteredRuns.length ? <div className="runtime-empty">暂无匹配 Run。</div> : null}
          </div>
        </aside>

        <section className="ops-main-stage">
          <section className="panel ops-graph-panel">
            <div className="section-head">
              <div>
                <h2>Agent State Machine</h2>
                <p>展示 Agent 从意图识别到人工确认的真实状态路径。</p>
              </div>
              <GitBranch size={20} />
            </div>
            <div className="ops-state-rail">
              {stateSteps.map((step, index) => {
                return (
                  <button key={step.id} className={`${activeTrace?.id === step.id ? 'active' : ''} ${step.status}`} onClick={() => setActiveTraceId(step.id)}>
                    <em>{String(index + 1).padStart(2, '0')}</em>
                    <strong>{step.name}</strong>
                    <span>{step.status}</span>
                  </button>
                );
              })}
            </div>
            <svg className="ops-sparkline" viewBox="0 0 280 72" aria-hidden="true">
              <polyline points={trendPath} fill="none" stroke="#0f766e" strokeWidth="4" strokeLinecap="round" />
            </svg>
          </section>

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
                  <button key={item.id} className={activeTrace?.id === item.id ? 'active' : ''} onClick={() => setActiveTraceId(item.id)}>
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
        </section>

        <aside className="panel ops-detail-dock">
          <div className="section-head">
            <div>
              <h2>Run Detail</h2>
              <p>审批记录、失败回放和产物留档。</p>
            </div>
            <Workflow size={20} />
          </div>
          <textarea value={controlNote} onChange={(event) => setControlNote(event.target.value)} />
          <div className="ops-review-actions">
            <button className="primary-button" onClick={() => review('confirm')} disabled={!activeRun}><CheckCircle2 size={14} />确认</button>
            <button className="secondary-button" onClick={() => review('revise')} disabled={!activeRun}>修改</button>
            <button className="danger-button" onClick={() => review('reject')} disabled={!activeRun}><AlertTriangle size={14} />拒绝</button>
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
            {(activeRun?.reviewHistory || []).slice(0, 4).map((review, index) => (
              <article key={review._id || `${review.action}-${index}`}>
                <CheckCircle2 size={14} />
                <span>{review.action} {'->'} {review.nextStatus || 'reviewed'}</span>
                <em>{review.note || 'no note'}</em>
              </article>
            ))}
            {(activeRun?.controlHistory || []).slice(0, 4).map((control) => (
              <article key={control.id}>
                <RotateCcw size={14} />
                <span>{control.action} {'->'} {control.status}</span>
                <em>{control.reason || 'no reason'}</em>
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
      </main>

      <div className={`agentops-drawer-mask ${detailOpen ? 'open' : ''}`} onMouseDown={() => setDetailOpen(false)}>
        <aside className="agentops-run-drawer" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div>
              <span>RUN DETAIL</span>
              <h2>{activeRun?.intent?.label || 'Agent Run Detail'}</h2>
              <p>{activeRun?.prompt || '选择一个 Run 后可以查看完整状态流转、Trace、Artifact、审批和质量评分。'}</p>
            </div>
            <button className="secondary-button compact" type="button" onClick={() => setDetailOpen(false)}>关闭</button>
          </header>
          <div className="agentops-drawer-tabs">
            {[
              ['overview', '概览'],
              ['trace', 'Trace'],
              ['artifacts', 'Artifacts'],
              ['raw', 'Raw']
            ].map(([id, label]) => (
              <button key={id} type="button" className={detailTab === id ? 'active' : ''} onClick={() => setDetailTab(id as typeof detailTab)}>
                {label}
              </button>
            ))}
          </div>

          {detailTab === 'overview' ? (
            <>
              <div className="agentops-drawer-grid">
                <article>
                  <span>Status</span>
                  <strong>{activeRun?.status || 'no-run'}</strong>
                  <p>{activeRun?.intent?.goal || '暂无运行目标。'}</p>
                </article>
                <article>
                  <span>Quality</span>
                  <strong>{activeRun?.quality ? `${activeRun.quality.score}%` : 'pending'}</strong>
                  <p>{activeRun?.quality ? `${activeRun.quality.passed}/${activeRun.quality.total} checks · ${activeRun.quality.verdict}` : '运行完成后写入质量评分。'}</p>
                </article>
                <article>
                  <span>Runtime</span>
                  <strong>{String(activeRun?.provider?.provider || blueprint?.runtime.llm.provider || 'LLM')}</strong>
                  <p>{String(activeRun?.provider?.mode || blueprint?.runtime.llm.mode || 'unknown')} · {String(activeRun?.provider?.model || blueprint?.runtime.llm.model || 'model')}</p>
                </article>
                <article>
                  <span>Evidence</span>
                  <strong>{activeRun?.sources?.length || 0} sources</strong>
                  <p>{activeRun?.artifacts?.length || 0} artifacts · {activeRun?.trace?.length || 0} trace events</p>
                </article>
              </div>
              <div className="agentops-drawer-trace">
                {(activeRun?.stateTransitions || []).map((transition) => (
                  <article key={transition.id}>
                    <header>
                      <strong>{transition.from} {'->'} {transition.to}</strong>
                      <span>{formatTime(transition.at)}</span>
                    </header>
                    <p>{transition.label}{transition.reason ? ` · ${transition.reason}` : ''}</p>
                  </article>
                ))}
                {(activeRun?.quality?.checks || []).map((check) => (
                  <article key={check.key}>
                    <header>
                      <strong>{check.label}</strong>
                      <span>{check.passed ? 'passed' : 'failed'}</span>
                    </header>
                    <p>{check.value}</p>
                  </article>
                ))}
              </div>
            </>
          ) : null}

          {detailTab === 'trace' ? (
            <div className="agentops-drawer-trace">
              {(activeRun?.trace || []).map((item) => (
                <article key={item.id}>
                  <header>
                    <strong>{item.name}</strong>
                    <span>{item.status} · {item.durationMs || 0}ms · {item.tokenUsage || 0} tokens</span>
                  </header>
                  <pre>{formatJson({ input: item.input, output: item.output, error: item.error, tool: item.tool })}</pre>
                </article>
              ))}
            </div>
          ) : null}

          {detailTab === 'artifacts' ? (
            <div className="agentops-drawer-artifacts">
              {(activeRun?.artifacts || []).map((artifact) => (
                <article key={artifact.id}>
                  <header>
                    <strong>{artifact.title}</strong>
                    <span>{artifact.type} · {artifact.status} · v{artifact.version || 1}</span>
                  </header>
                  <div className="agentops-drawer-grid">
                    <article>
                      <span>Trace</span>
                      <strong>{artifact.traceStepId || 'unknown'}</strong>
                      <p>{artifact.reviewStatus || 'pending'}</p>
                    </article>
                    <article>
                      <span>Citations</span>
                      <strong>{artifact.sourceRefs?.length || 0}</strong>
                      <p>{(artifact.sourceRefs || []).slice(0, 3).map((source) => `[${source.index}] ${source.title}`).join(' / ') || 'no source refs'}</p>
                    </article>
                    <article>
                      <span>Versions</span>
                      <strong>{artifact.versions?.length || 0}</strong>
                      <p>{(artifact.versions || []).slice(0, 3).map((item) => `v${item.version} ${item.status}`).join(' / ') || 'no version history'}</p>
                    </article>
                    <article>
                      <span>Approvals / Exports</span>
                      <strong>{(artifact.approvals?.length || 0) + (artifact.exports?.length || 0)}</strong>
                      <p>{artifact.exports?.[0]?.filename || artifact.approvals?.[0]?.note || 'no operation history'}</p>
                    </article>
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          {detailTab === 'raw' ? <pre className="agentops-drawer-raw">{formatJson(activeRun)}</pre> : null}
        </aside>
      </div>
    </div>
  );
}

function FileBadge({ title }: { title: string }) {
  return (
    <span className="ops-file-badge">
      <ClipboardCheck size={14} />
      {title}
    </span>
  );
}

function ShieldValue({ score }: { score?: number }) {
  return (
    <span className="ops-file-badge">
      <CheckCircle2 size={14} />
      {typeof score === 'number' ? `${score}%` : 'pending'}
    </span>
  );
}

function MetricTrendCard({ label, value, desc, path, tone = 'teal' }: { label: string; value: string; desc: string; path: string; tone?: 'teal' | 'blue' | 'cyan' }) {
  return (
    <article className={`ops-metric-trend-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <svg viewBox="0 0 280 72" aria-hidden="true">
        <polyline points={path} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p>{desc}</p>
    </article>
  );
}
