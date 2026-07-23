import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Copy, Database, FileText, Pause, RefreshCw, Send, ShieldCheck, Sparkles } from 'lucide-react';
import { request, streamRequest } from '../../api/client';
import { Header } from '../../components/ui';

type AgentSession = {
  _id: string;
  title: string;
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string }>;
};

type Source = {
  _id: string;
  documentTitle: string;
  content: string;
  score: number;
  retrievalBackend?: string;
  sourcePath?: string;
};

type Artifact = {
  id: string;
  type: string;
  title: string;
  status: string;
  content: string | Record<string, unknown>;
  version?: number;
  traceStepId?: string;
  reviewStatus?: string;
  versions?: Array<{ version: number; status: string; createdAt: string }>;
  approvals?: Array<{ action: string; note?: string; createdAt: string }>;
  exports?: Array<{ id: string; format: string; filename: string; exportedAt: string }>;
  sourceRefs?: Array<{ id: string; index: number; title: string; score: number; retrievalBackend?: string }>;
  generatedBy?: { tool: string; traceStepId: string; generatedAt: string };
};

type TraceStep = {
  id: string;
  name: string;
  status: string;
  durationMs?: number;
  tokenUsage?: number;
  error?: string;
};

type RunQuality = {
  score: number;
  passed: number;
  total: number;
  verdict: string;
};

type AgentRun = {
  _id: string;
  runId: string;
  status: string;
  answer?: string;
  sources?: Source[];
  artifacts?: Artifact[];
  trace?: TraceStep[];
  quality?: RunQuality;
};

type EvalCase = {
  id: string;
  title: string;
  prompt: string;
  expected: string[];
  lastResult?: RunQuality;
  evalHistory?: Array<{ score: number; verdict: string; createdAt: string }>;
};

type RuntimeBlueprint = {
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

function stringify(content: unknown) {
  return typeof content === 'string' ? content : JSON.stringify(content, null, 2);
}

function shortText(value = '', size = 150) {
  return value.length > size ? `${value.slice(0, size)}...` : value;
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const deliveryTaskModes = [
  {
    id: 'product-workflow',
    title: '产品交付工作流',
    desc: '需求澄清、PRD、页面结构、接口协议和任务拆解',
    agentId: 'product-delivery-agent',
    scopes: ['architecture', 'standards', 'ai-native', 'frontend'],
    promptSuffix: '请按产品交付工作流输出 PRD 摘要、页面结构、接口协议、状态流转、研发任务拆解、风险和待确认问题。'
  },
  {
    id: 'requirement-analysis',
    title: '架构级需求分析',
    desc: '拆目标、约束、风险、验收标准和待确认问题',
    agentId: 'product-delivery-agent',
    scopes: ['architecture', 'standards', 'frontend'],
    promptSuffix: '请先做架构级需求分析，输出目标、非功能约束、风险、验收标准、待确认问题和下一步交付计划。'
  },
  {
    id: 'knowledge-assistant',
    title: '知识库问答方案',
    desc: '知识范围、RAG 引用、纠错反馈和运营治理',
    agentId: 'knowledge-assistant',
    scopes: ['architecture', 'standards', 'ai-native', 'im'],
    promptSuffix: '请围绕知识库问答产品输出知识范围、RAG 检索链路、引用来源展示、人工纠错、会话历史和质量评估方案。'
  },
  {
    id: 'delivery-review',
    title: '交付质量评审',
    desc: '测试策略、上线风险、质量门禁和人工审批',
    agentId: 'delivery-review-agent',
    scopes: ['standards', 'architecture', 'sdk'],
    promptSuffix: '请对本需求做交付质量评审，输出测试策略、风险清单、上线门禁、缺口和人工审批建议。'
  }
];

export default function DeliveryCopilot() {
  const [session, setSession] = useState<AgentSession | null>(null);
  const [blueprint, setBlueprint] = useState<RuntimeBlueprint | null>(null);
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [requirement, setRequirement] = useState('为企业内部 AI 产品研发团队建设一个需求到交付 Copilot 工作台，要求覆盖 PRD、页面结构、BFF 接口协议、任务拆解、风险确认和人工审批。');
  const [audience, setAudience] = useState('产品经理、前端工程师、后端工程师、测试负责人');
  const [deadline, setDeadline] = useState('3 个工作日内完成可演示 MVP');
  const [constraints, setConstraints] = useState('React + TypeScript + Node BFF；必须展示 RAG 引用、Trace、人工确认和导出产物。');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [quality, setQuality] = useState<RunQuality | null>(null);
  const [activeArtifactId, setActiveArtifactId] = useState('');
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [artifactDraft, setArtifactDraft] = useState('');
  const [taskModeId, setTaskModeId] = useState(deliveryTaskModes[0].id);
  const [selectedEvalCaseId, setSelectedEvalCaseId] = useState('');
  const [status, setStatus] = useState('idle');
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);

  const activeArtifact = useMemo(() => artifacts.find((item) => item.id === activeArtifactId) || artifacts[0], [activeArtifactId, artifacts]);
  const activeTaskMode = useMemo(() => deliveryTaskModes.find((item) => item.id === taskModeId) || deliveryTaskModes[0], [taskModeId]);
  const ragRuntime = blueprint?.runtime.rag;
  const ragLive = Boolean(ragRuntime?.productionReady || ragRuntime?.vectorSearchReady);
  const artifactSummary = useMemo(() => {
    const slots = [
      { type: 'prd', title: 'PRD 摘要' },
      { type: 'flow', title: '页面结构' },
      { type: 'api', title: 'API Contract' },
      { type: 'task', title: '任务拆解' },
      { type: 'risk', title: '风险确认' }
    ];
    return slots.map((slot) => {
      const artifact = artifacts.find((item) => item.type === slot.type);
      return { ...slot, artifact, done: Boolean(artifact), confirmed: artifact?.status === 'confirmed' };
    });
  }, [artifacts]);
  const prompt = useMemo(() => [
    `业务需求：${requirement}`,
    `目标用户：${audience}`,
    `交付目标：${deadline}`,
    `约束条件：${constraints}`,
    activeTaskMode.promptSuffix
  ].join('\n'), [activeTaskMode.promptSuffix, audience, constraints, deadline, requirement]);

  const load = useCallback(async () => {
    const [blueprintResult, sessionResult, caseResult] = await Promise.all([
      request('/api/agent-studio/blueprint'),
      request('/api/agent-studio/sessions'),
      request('/api/agent-studio/eval-cases')
    ]);
    setBlueprint(blueprintResult);
    setCases(caseResult.cases || []);
    if (sessionResult.sessions?.[0]) {
      setSession(sessionResult.sessions[0]);
      return;
    }
    const created = await request('/api/agent-studio/sessions', {
      method: 'POST',
      body: JSON.stringify({ title: 'Copilot 交付工作台会话' })
    });
    setSession(created.session);
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [answer, running]);

  async function run(nextPrompt = prompt, evalCaseId = selectedEvalCaseId) {
    if (!session || running || !nextPrompt.trim()) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setAnswer('');
    setSources([]);
    setArtifacts([]);
    setTrace([]);
    setQuality(null);
    setStatus('validating');
    try {
      await streamRequest(`/api/agent-studio/sessions/${session._id}/runs/stream`, {
        message: nextPrompt,
        evalCaseId,
        commandOptions: {
          agentId: activeTaskMode.agentId,
          skillId: activeTaskMode.agentId,
          scopes: activeTaskMode.scopes,
          taskModeId: activeTaskMode.id,
          source: 'delivery-copilot'
        }
      }, {
        run_status: (payload) => setStatus(payload.status || 'running'),
        trace: (payload) => setTrace((items) => [...items.filter((item) => item.id !== payload.id), payload]),
        sources: (payload) => setSources(payload.sources || []),
        artifacts: (payload) => {
          setArtifacts(payload.artifacts || []);
          setActiveArtifactId(payload.artifacts?.[0]?.id || '');
          setArtifactDraft(stringify(payload.artifacts?.[0]?.content || ''));
        },
        delta: (payload) => setAnswer((current) => current + payload.text),
        final: (payload: { run: AgentRun }) => {
          setStatus(payload.run?.status || 'review_required');
          setAnswer(payload.run?.answer || '');
          setSources(payload.run?.sources || []);
          setArtifacts(payload.run?.artifacts || []);
          setTrace(payload.run?.trace || []);
          setQuality(payload.run?.quality || null);
          setActiveRun(payload.run || null);
          setActiveArtifactId(payload.run?.artifacts?.[0]?.id || '');
          setArtifactDraft(stringify(payload.run?.artifacts?.[0]?.content || ''));
          if (evalCaseId && payload.run?._id) void scoreEvalCase(payload.run, evalCaseId);
        }
      }, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatus('failed');
        setAnswer(`运行失败：${(error as Error).message}`);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
    setStatus('cancelled');
  }

  function loadCase(item: EvalCase) {
    setSelectedEvalCaseId(item.id);
    setRequirement(item.prompt);
    setAudience('产品经理、研发负责人、前后端工程师、测试负责人');
    setDeadline('一周内完成可评审方案与 Demo');
    setConstraints(`验收重点：${item.expected.join('、')}`);
  }

  async function refreshEvalCases() {
    const caseResult = await request('/api/agent-studio/eval-cases');
    setCases(caseResult.cases || []);
  }

  async function scoreEvalCase(run: AgentRun, evalCaseId: string) {
    if (!run?._id || !evalCaseId) return;
    try {
      const result = await request(`/api/agent-studio/eval-cases/${evalCaseId}/score`, {
        method: 'POST',
        body: JSON.stringify({ runId: run._id })
      });
      if (result.run) syncRun(result.run);
      await refreshEvalCases();
    } catch (error) {
      console.warn('Eval scoring failed', error);
    }
  }

  async function copy(text: string) {
    await navigator.clipboard?.writeText(text);
  }

  function selectArtifact(artifact: Artifact) {
    setActiveArtifactId(artifact.id);
    setArtifactDraft(stringify(artifact.content));
  }

  function syncRun(run: AgentRun) {
    setActiveRun(run);
    setStatus(run.status || status);
    setArtifacts(run.artifacts || []);
    setTrace(run.trace || []);
    setSources(run.sources || []);
    setQuality(run.quality || null);
    const nextArtifact = (run.artifacts || []).find((item) => item.id === activeArtifactId) || run.artifacts?.[0];
    if (nextArtifact) {
      setActiveArtifactId(nextArtifact.id);
      setArtifactDraft(stringify(nextArtifact.content));
    }
  }

  async function saveArtifact() {
    if (!activeRun?._id || !activeArtifact) return;
    const result = await request(`/api/agent-studio/runs/${activeRun._id}/artifacts/${activeArtifact.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: artifactDraft, status: 'editing', reviewStatus: 'pending' })
    });
    syncRun(result.run);
  }

  async function confirmArtifact() {
    if (!activeRun?._id || !activeArtifact) return;
    const result = await request(`/api/agent-studio/runs/${activeRun._id}/artifacts/${activeArtifact.id}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ note: 'Copilot 交付工作台确认该 Artifact 可进入下一阶段。' })
    });
    syncRun(result.run);
  }

  async function exportArtifact(format: 'markdown' | 'json') {
    if (!activeRun?._id || !activeArtifact) return;
    const result = await request(`/api/agent-studio/runs/${activeRun._id}/artifacts/${activeArtifact.id}/export?format=${format}`);
    downloadFile(
      result.filename || `${activeArtifact.type}.${format === 'json' ? 'json' : 'md'}`,
      result.content || '',
      format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8'
    );
    if (result.run) syncRun(result.run);
  }

  return (
    <div className="delivery-page">
      <div className="product-page-kicker">Delivery Copilot Workbench</div>
      <Header
        title="Copilot 交付工作台"
        desc="面向业务交付：从需求输入、RAG 上下文、流式分析到 PRD / 页面结构 / API / 任务拆解 Artifact。"
      />

      <section className="delivery-hero panel">
        <div>
          <span>Product Delivery Flow</span>
          <h2>需求到产物的 AI 工作流</h2>
          <p>这里不是运行监控，而是业务交付工作区。用户输入目标，系统检索知识库，流式分析并产出可评审交付物。</p>
        </div>
        <div className="delivery-runtime">
          <article>
            <strong>{blueprint?.runtime.llm.provider || 'LLM'}</strong>
            <span>{blueprint?.runtime.llm.mode || 'loading'} · {blueprint?.runtime.llm.model || 'model'}</span>
          </article>
          <article className={ragLive ? 'live' : 'fallback'}>
            <strong>{ragRuntime?.retrievalBackend || ragRuntime?.vectorStore || 'RAG'}</strong>
            <span>{ragLive ? 'live vector store' : 'fallback'} · {ragRuntime?.index || 'index pending'}</span>
          </article>
          <article>
            <strong>{quality ? `${quality.score}%` : 'pending'}</strong>
            <span>{quality ? `${quality.passed}/${quality.total} checks` : 'quality'}</span>
          </article>
        </div>
      </section>

      <section className="delivery-artifact-overview panel">
        {artifactSummary.map((item) => (
          <button
            key={item.type}
            className={item.artifact?.id === activeArtifact?.id ? 'active' : ''}
            type="button"
            disabled={!item.artifact}
            onClick={() => item.artifact && selectArtifact(item.artifact)}
          >
            <CheckCircle2 size={15} />
            <strong>{item.title}</strong>
            <span>{item.confirmed ? 'confirmed' : item.done ? 'ready' : 'waiting'} · {item.artifact ? `v${item.artifact.version || 1}` : 'no artifact'}</span>
          </button>
        ))}
      </section>

      <main className="delivery-workspace">
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
            {deliveryTaskModes.map((item) => (
              <button key={item.id} type="button" className={taskModeId === item.id ? 'active' : ''} onClick={() => setTaskModeId(item.id)}>
                <b>{item.title}</b>
                <span>{item.desc}</span>
              </button>
            ))}
          </div>
          <label>业务需求<textarea value={requirement} onChange={(event) => setRequirement(event.target.value)} /></label>
          <div className="delivery-two-fields">
            <label>目标用户<input value={audience} onChange={(event) => setAudience(event.target.value)} /></label>
            <label>交付目标<input value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label>
          </div>
          <label>约束条件<textarea value={constraints} onChange={(event) => setConstraints(event.target.value)} /></label>
          <div className="delivery-actions">
            <button className="primary-button" disabled={running} onClick={() => run()}><Send size={15} />生成交付物</button>
            <button className="secondary-button" disabled={!running} onClick={stop}><Pause size={15} />停止</button>
            <button className="secondary-button" disabled={running} onClick={() => run(prompt)}><RefreshCw size={15} />重跑</button>
          </div>

          <div className="delivery-cases">
            <strong>真实 Eval Cases</strong>
            {cases.map((item) => (
              <button key={item.id} className={selectedEvalCaseId === item.id ? 'active' : ''} onClick={() => loadCase(item)}>
                <b>{item.title}</b>
                <span>{item.expected.join(' / ')}</span>
                <em>{item.lastResult ? `${item.lastResult.passed}/${item.lastResult.total} passed` : '未运行'}</em>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel delivery-stream">
          <div className="section-head">
            <div>
              <h2>流式分析过程</h2>
              <p>展示 AI 如何把需求拆解为上下文、计划和结论。</p>
            </div>
            <span className={`delivery-status ${status}`}>{running ? 'streaming' : status}</span>
          </div>
          <div className="delivery-flow-steps">
            {['需求校验', 'RAG 检索', '工具产物', '流式总结', '人工确认'].map((item, index) => (
              <article key={item} className={trace.length > index || running ? 'active' : ''}>
                <em>{String(index + 1).padStart(2, '0')}</em>
                <strong>{item}</strong>
              </article>
            ))}
          </div>
          <div className="delivery-output" ref={outputRef}>
            {answer ? <pre>{answer}</pre> : <div className="runtime-empty">点击生成后，这里会展示真实 SSE 流式分析过程。</div>}
          </div>
        </section>

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
              <span>{ragRuntime?.vectorStore || 'retrieval loading'}</span>
            </div>
            <p>
              {ragLive
                ? `Index ${ragRuntime?.index || 'default'} · Path ${ragRuntime?.vectorPath || 'embedding'} · ${ragRuntime?.dimensions || 0} dims`
                : (ragRuntime?.error || '当前未启用真实向量库，使用 local deterministic embedding。')}
            </p>
            <em>{ragRuntime?.connection || (ragRuntime?.connected ? 'connected' : 'not connected')}</em>
          </div>
          <div className="delivery-source-list">
            {sources.map((source, index) => (
              <article key={source._id || index}>
                <strong>[{index + 1}] {source.documentTitle}</strong>
                <span>score {Number(source.score || 0).toFixed(4)} · {source.retrievalBackend || 'local'}</span>
                <p>{shortText(source.content, 180)}</p>
              </article>
            ))}
            {!sources.length ? <div className="runtime-empty">运行后展示真实命中的 chunk、score 和 citation。</div> : null}
          </div>
          <div className="delivery-review-box">
            <ShieldCheck size={18} />
            <div>
              <strong>人工确认节点</strong>
              <p>PRD、API、任务拆解和风险项生成后，进入人工确认再继续交付。</p>
            </div>
          </div>
          <div className="delivery-mini-trace">
            <strong>真实 Trace</strong>
            {trace.slice(0, 6).map((item) => (
              <span key={item.id}>{item.name} · {item.status} · {item.durationMs || 0}ms</span>
            ))}
            {!trace.length ? <p>运行后展示 Agent 状态流转。</p> : null}
          </div>
        </aside>
      </main>

      <section className="panel delivery-artifacts">
        <div className="section-head">
          <div>
            <h2>Artifact 交付物总览</h2>
            <p>把模型输出变成可预览、可复制、可确认、可导出的产品资产。</p>
          </div>
          <span>{artifacts.length} artifacts</span>
        </div>
        <div className="delivery-artifact-shell">
          <nav>
            {artifacts.map((artifact) => (
              <button key={artifact.id} className={activeArtifact?.id === artifact.id ? 'active' : ''} onClick={() => selectArtifact(artifact)}>
                <FileText size={15} />
                <strong>{artifact.title}</strong>
                <span>{artifact.status} · {artifact.reviewStatus || 'pending'} · v{artifact.version || 1}</span>
              </button>
            ))}
            {!artifacts.length ? <div className="runtime-empty">暂无交付物。</div> : null}
          </nav>
          <article>
            {activeArtifact ? (
              <>
                <header>
                  <div>
                    <strong>{activeArtifact.title}</strong>
                    <span>trace: {activeArtifact.traceStepId || 'unknown'} · {activeArtifact.type}</span>
                  </div>
                  <div>
                    <button className="secondary-button compact" onClick={() => copy(artifactDraft)}><Copy size={13} />复制</button>
                    <button className="secondary-button compact" disabled={!activeRun} onClick={saveArtifact}>保存版本</button>
                    <button className="secondary-button compact" disabled={!activeRun} onClick={() => exportArtifact('markdown')}>导出 MD</button>
                    <button className="secondary-button compact" disabled={!activeRun} onClick={() => exportArtifact('json')}>导出 JSON</button>
                    <button className="primary-button compact" disabled={!activeRun} onClick={confirmArtifact}><CheckCircle2 size={13} />确认</button>
                  </div>
                </header>
                <div className="delivery-artifact-editor">
                  <textarea value={artifactDraft} onChange={(event) => setArtifactDraft(event.target.value)} />
                  <aside>
                    <strong>版本与审批</strong>
                    <span>Trace · {activeArtifact.generatedBy?.traceStepId || activeArtifact.traceStepId || 'unknown'}</span>
                    <span>Tool · {activeArtifact.generatedBy?.tool || 'planDelivery'}</span>
                    {(activeArtifact.sourceRefs || []).slice(0, 4).map((item) => (
                      <span key={item.id}>[{item.index}] {item.title} · {Number(item.score || 0).toFixed(4)}</span>
                    ))}
                    {(activeArtifact.versions || []).slice(0, 5).map((item) => (
                      <span key={`${item.version}-${item.createdAt}`}>v{item.version} · {item.status}</span>
                    ))}
                    {(activeArtifact.approvals || []).slice(0, 5).map((item, index) => (
                      <span key={`${item.createdAt}-${index}`}>{item.action} · {item.note || '已确认'}</span>
                    ))}
                    {(activeArtifact.exports || []).slice(0, 5).map((item) => (
                      <span key={item.id}>export · {item.format} · {item.filename}</span>
                    ))}
                    {!activeArtifact.versions?.length && !activeArtifact.approvals?.length ? <p>保存或确认后会产生真实版本和审批记录。</p> : null}
                  </aside>
                </div>
              </>
            ) : (
              <div className="runtime-empty">生成后选择左侧 Artifact 查看详情。</div>
            )}
          </article>
        </div>
      </section>
    </div>
  );
}
