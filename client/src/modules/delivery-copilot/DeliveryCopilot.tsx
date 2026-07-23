import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { request, streamRequest } from '../../api/client';
import { Header } from '../../components/ui';
import { ArtifactOverview } from './components/ArtifactOverview';
import { ArtifactWorkbench } from './components/ArtifactWorkbench';
import { KnowledgeContext } from './components/KnowledgeContext';
import { ApprovalPanel } from './components/ApprovalPanel';
import { SessionPanel } from './components/SessionPanel';
import { SkillSelector } from './components/SkillSelector';
import { StreamPanel } from './components/StreamPanel';
import { TraceTimeline } from './components/TraceTimeline';
import type { AgentRun, AgentSession, Artifact, EvalCase, RunQuality, RuntimeBlueprint, Source, TraceStep } from './types';
import { downloadFile, getRetrievalView, stringify } from './utils';

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
  const retrievalView = useMemo(() => getRetrievalView(ragRuntime, sources), [ragRuntime, sources]);
  const ragLive = retrievalView.live;
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

      <SessionPanel blueprint={blueprint} ragRuntime={ragRuntime} ragLive={ragLive} quality={quality} />

      <ArtifactOverview
        artifactSummary={artifactSummary}
        activeArtifactId={activeArtifact?.id}
        onSelectArtifact={selectArtifact}
      />

      <main className="delivery-workspace">
        <SkillSelector
          taskModes={deliveryTaskModes}
          taskModeId={taskModeId}
          onTaskModeChange={setTaskModeId}
          requirement={requirement}
          audience={audience}
          deadline={deadline}
          constraints={constraints}
          onRequirementChange={setRequirement}
          onAudienceChange={setAudience}
          onDeadlineChange={setDeadline}
          onConstraintsChange={setConstraints}
          cases={cases}
          selectedEvalCaseId={selectedEvalCaseId}
          onLoadCase={loadCase}
          running={running}
          onRun={() => run()}
          onStop={stop}
          onRerun={() => run(prompt)}
        />

        <StreamPanel
          status={status}
          running={running}
          trace={trace}
          answer={answer}
          outputRef={outputRef}
        />

        <TraceTimeline trace={trace} status={status} />

        <KnowledgeContext
          ragLive={ragLive}
          ragRuntime={ragRuntime}
          retrievalView={retrievalView}
          prompt={prompt}
          requirement={requirement}
          sources={sources}
          trace={trace}
        />

        <ApprovalPanel
          activeRun={activeRun}
          activeArtifact={activeArtifact}
          artifactSummary={artifactSummary}
          onSelectArtifact={selectArtifact}
          onConfirmArtifact={confirmArtifact}
        />
      </main>

      <ArtifactWorkbench
        artifacts={artifacts}
        activeArtifact={activeArtifact}
        activeRun={activeRun}
        artifactDraft={artifactDraft}
        onArtifactDraftChange={setArtifactDraft}
        onSelectArtifact={selectArtifact}
        onCopy={copy}
        onSaveArtifact={saveArtifact}
        onConfirmArtifact={confirmArtifact}
        onExportArtifact={exportArtifact}
      />
    </div>
  );
}
