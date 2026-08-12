import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, Copy, Pause, Play, RefreshCw, RotateCcw, Send, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import { Header, Status } from '../../components/ui';
import { getAgentStudioBlueprint } from '../../services/blueprintService';
import { listAgentStudioRuns } from '../../services/agentRunService';
import { useSession } from '../../hooks/useSession';
import { useAgentRun } from '../../hooks/useAgentRun';
import { useEval } from '../../hooks/useEval';
import { subscribeRuntimeModelSettingsChanged } from '../../platform/runtimeModelEvents';

let localMessageSeed = 0;
const createLocalMessageId = (prefix: string) => `${prefix}-local-${localMessageSeed += 1}`;

type AgentCapability = { id: string; name: string; description: string; intents: string[]; tools: string[] };
type AgentSession = { _id: string; title: string; activeAgentId?: string; messages: AgentMessage[] };
type AgentMessage = { id: string; role: 'user' | 'assistant'; content: string; sources?: any[]; trace?: any[]; runId?: string };
type TraceStep = { id: string; name: string; status: 'running' | 'success' | 'waiting' | 'failed'; durationMs?: number; tokenUsage?: number; input?: unknown; output?: unknown; error?: string; tool?: string; humanRequired?: boolean };
type RagSource = { _id: string; documentTitle: string; content: string; score: number; retrievalBackend?: string; sourcePath?: string };
type Artifact = { id: string; type: string; title: string; status: string; content: string | Record<string, unknown>; version?: number; reviewStatus?: string; traceStepId?: string; versions?: Array<{ version: number; status: string; at?: string; createdAt?: string; content?: unknown }>; approvals?: Array<{ action: string; note?: string; reviewerId?: string; createdAt: string }> };
type AgentPlanItem = { id: string; name: string; owner: string; status: string; guardrail: string; tool: string; output?: unknown; error?: string };
type AgentLog = { id: string; level: string; message: string; at: string; tool?: string; action?: string };
type AgentIntent = { id: string; label: string; goal: string; scopes: string[]; riskLevel: string; confidence?: number; signals?: string[] };
type AgentRun = { _id: string; runId: string; status: string; prompt: string; intent?: AgentIntent; selectedSkill?: AgentCapability; plan?: AgentPlanItem[]; sources?: RagSource[]; artifacts?: Artifact[]; trace?: TraceStep[]; logs?: AgentLog[]; answer?: string; createdAt?: string; review?: any; controlState?: any; provider?: { provider?: string; mode?: string; model?: string; requestedModel?: string; primaryModel?: string; runtimeVersion?: number; fallbackUsed?: boolean; attemptedModels?: string[] }; quality?: RunQuality; evalCaseId?: string };
type RunQuality = { score: number; passed: number; total: number; avgCitationScore: number; verdict: string; checks: Array<{ key: string; label: string; passed: boolean; value: string }> };
type EvalCase = { id: string; title: string; prompt: string; expected: string[]; status: string; lastResult?: RunQuality };
type AgentRunState = { status: string; label: string; runId?: string; intent?: AgentIntent; selectedSkill?: AgentCapability; plan?: AgentPlanItem[] };
type Blueprint = { capabilities: AgentCapability[]; architecture: { frontend: string[]; bff: string[]; states: string[]; data: string[] }; controls?: { supportedActions: string[]; policy: string }; runtime: { llm: { provider: string; mode: string; model: string; configured: boolean }; rag: { backend: string; retrievalBackend?: string; vectorStore: string; productionReady: boolean; mode?: string; connected?: boolean; vectorSearchReady?: boolean; error?: string; connection?: string; index?: string } } };

const starterPrompts = [
    '为企业内部 AI 产品研发团队设计一个需求到交付 Agent，要求输出 PRD、页面结构、BFF API、测试策略和上线风险。',
    '建设智能客服知识库助手，支持文档上传、问题检索、答案引用、人工纠错和质检反馈。',
    '设计投研报告生成工作台，要求资料导入、RAG 检索、章节生成、引用校验、合规复核和导出。',
    '帮我评审一个 AI 前端工作台方案，重点看流式体验、Agent Trace、人工确认和测试门禁。'
];
const stateFlow = ['idle', 'intent_detected', 'skill_selected', 'retrieving', 'tool_running', 'streaming', 'review_required', 'paused', 'resumed', 'rolled_back', 'confirmed'];

function stringifyContent(content: unknown) { return typeof content === 'string' ? content : JSON.stringify(content, null, 2); }
function latestPair(messages: AgentMessage[]) {
    const clean = messages.filter((message) => message.content?.trim());
    const lastUser = clean.map((message) => message.role).lastIndexOf('user');
    if (lastUser >= 0) return clean.slice(lastUser, lastUser + 2);
    return clean.slice(-2);
}
function formatTime(value?: string) { if (!value) return 'just now'; return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function buildTrendPath(points: number[], width = 320, height = 92) {
    if (!points.length) return '';
    const max = Math.max(...points, 1);
    const step = points.length > 1 ? width / (points.length - 1) : width;
    return points.map((point, index) => { const x = Math.round(index * step); const y = Math.round(height - (point / max) * (height - 12) - 6); return `${x},${y}`; }).join(' ');
}
function formatDateTime(value?: string) { if (!value) return '未记录'; return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
async function copyText(text: string) { await navigator.clipboard?.writeText(text); }

function MessageContent({ content }: { content: string }) {
    const blocks = content.split(/```/g);
    return (<div className="runtime-message-content">{blocks.map((block, index) => {
        if (index % 2 === 1) return <pre key={index}>{block.replace(/^\w+\n/, '')}</pre>;
        return block.trim().split(/\n{2,}/).filter(Boolean).map((paragraph, paragraphIndex) => {
            const title = paragraph.match(/^#{1,3}\s+(.+)/)?.[1];
            if (title) return <h3 key={`${index}-${paragraphIndex}`}>{title}</h3>;
            if (/^[-*]\s+/m.test(paragraph)) return (<ul key={`${index}-${paragraphIndex}`}>{paragraph.split('\n').filter(Boolean).map((line) => <li key={line}>{line.replace(/^[-*]\s+/, '')}</li>)}</ul>);
            return <p key={`${index}-${paragraphIndex}`}>{paragraph.replace(/^#{1,3}\s+/, '')}</p>;
        });
    })}</div>);
}

export default function AgentStudio() {
    const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
    const [runs, setRuns] = useState<AgentRun[]>([]);
    const [message, setMessage] = useState(starterPrompts[0]);
    const [runState, setRunState] = useState<AgentRunState>({ status: 'idle', label: '等待运行' });
    const [openTraceIds, setOpenTraceIds] = useState<string[]>([]);
    const [answer, setAnswer] = useState('');
    const [reviewNote, setReviewNote] = useState('确认该 Agent Run 的产物可进入下一阶段交付。');
    const [runFilter, setRunFilter] = useState('all');
    const [runSearch, setRunSearch] = useState('');
    const [selectedNodeId, setSelectedNodeId] = useState('intent');
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [drawerTab, setDrawerTab] = useState<'overview' | 'trace' | 'artifacts' | 'raw'>('overview');
    const abortRef = useRef<AbortController | null>(null);
    const logRef = useRef<HTMLDivElement | null>(null);

    const session = useSession();
    const agentRun = useAgentRun('agent-studio');
    const evalCase = useEval('agent-studio');
    const { sessions, setSessions, active, setActive, load: loadSession, create: createSessionSvc } = session;
    const { trace, setTrace, sources, setSources, artifacts, setArtifacts, plan, setPlan, logs, setLogs, activeRun, setActiveRun, running, setRunning, start } = agentRun;
    const { cases: evalCases, setCases, load: loadEvalCases, refresh: refreshEval } = evalCase;

    const visibleMessages = useMemo(() => latestPair(active?.messages || []), [active?.messages]);
    const hasRunContext = Boolean(activeRun || running || runState.runId);
    const currentIntent = hasRunContext ? runState.intent || activeRun?.intent : undefined;
    const currentSkill = hasRunContext ? runState.selectedSkill || activeRun?.selectedSkill : undefined;
    const currentPlan = plan.length ? plan : activeRun?.plan || [];
    const currentTrace = useMemo(() => trace.length ? trace : activeRun?.trace || [], [activeRun?.trace, trace]);
    const currentSources = sources.length ? sources : activeRun?.sources || [];
    const currentArtifacts = artifacts.length ? artifacts : activeRun?.artifacts || [];
    const currentLogs = useMemo(() => logs.length ? logs : activeRun?.logs || [], [activeRun?.logs, logs]);
    const activeRunId = activeRun?._id || runState.runId || visibleMessages.find((item) => item.runId)?.runId;
    const actualRunModel = String(activeRun?.provider?.requestedModel || activeRun?.provider?.model || '');
    const runUsedFallback = activeRun?.provider?.fallbackUsed === true;
    const toolCalls = currentTrace.filter((item) => item.tool || item.input || item.output || item.error);
    const stateIndex = Math.max(0, stateFlow.indexOf(runState.status));
    const traceById = useMemo(() => new Map(currentTrace.map((item) => [item.id, item])), [currentTrace]);
    const graphNodes = useMemo(() => [
        { id: 'intent', label: 'Intent', desc: '意图识别', owner: 'Intent Router', trace: traceById.get('intent') },
        { id: 'skill', label: 'Skill', desc: '自动选择能力', owner: 'Skill Runtime', trace: traceById.get('skill') },
        { id: 'rag', label: 'RAG', desc: '检索上下文', owner: 'Knowledge Engine', trace: traceById.get('rag') },
        { id: 'plan', label: 'Tool', desc: '执行工具链', owner: 'Tool Runtime', trace: traceById.get('plan') },
        { id: 'llm', label: 'LLM', desc: '流式生成', owner: 'Provider Adapter', trace: traceById.get('llm') },
        { id: 'review', label: 'Review', desc: '人工确认', owner: 'Human-in-loop', trace: traceById.get('review') }
    ], [traceById]);
    const selectedNode = graphNodes.find((node) => node.id === selectedNodeId) || graphNodes[0];
    const filteredRuns = useMemo(() => runs.filter((run) => {
        const matchedStatus = runFilter === 'all' || run.status === runFilter;
        const keyword = runSearch.trim().toLowerCase();
        const matchedText = !keyword || [run.prompt, run.intent?.label, run.selectedSkill?.name, run.status].filter(Boolean).some((item) => String(item).toLowerCase().includes(keyword));
        return matchedStatus && matchedText;
    }), [runFilter, runSearch, runs]);
    const opsMetrics = useMemo(() => {
        const traceItems = runs.flatMap((run) => run.trace || []);
        const totalTokens = traceItems.reduce((sum, item) => sum + (item.tokenUsage || 0), 0);
        const totalLatency = traceItems.reduce((sum, item) => sum + (item.durationMs || 0), 0);
        const failed = runs.filter((run) => run.status === 'failed' || run.trace?.some((item) => item.status === 'failed')).length;
        const waiting = runs.filter((run) => ['review_required', 'waiting', 'paused'].includes(run.status)).length;
        const confirmed = runs.filter((run) => run.status === 'confirmed').length;
        return { total: runs.length, sessions: sessions.length, waiting, failed, confirmed, avgLatency: traceItems.length ? Math.round(totalLatency / traceItems.length) : 0, totalTokens };
    }, [runs, sessions.length]);
    const trend = useMemo(() => {
        const recent = runs.slice(0, 12).reverse();
        const latency = recent.map((run) => (run.trace || []).reduce((sum, item) => sum + (item.durationMs || 0), 0));
        const tokens = recent.map((run) => (run.trace || []).reduce((sum, item) => sum + (item.tokenUsage || 0), 0));
        const success = recent.map((run) => (run.status === 'confirmed' || run.status === 'review_required' ? 1 : 0));
        return { count: recent.length, latencyPath: buildTrendPath(latency), tokenPath: buildTrendPath(tokens), successPath: buildTrendPath(success), failureRate: runs.length ? Math.round((opsMetrics.failed / runs.length) * 100) : 0 };
    }, [opsMetrics.failed, runs]);
    const approvalTimeline = useMemo(() => {
        const items = [
            ...currentTrace.filter((item) => item.humanRequired || item.id === 'review').map((item) => ({ id: `trace-${item.id}`, type: item.status === 'failed' ? 'failed' : item.status === 'waiting' ? 'waiting' : 'system', title: item.name, desc: item.humanRequired ? '该节点要求人工确认后继续。' : '审计节点已记录。', at: activeRun?.createdAt })),
            ...(activeRun?.controlState ? [{ id: 'control-state', type: activeRun.controlState.status || 'control', title: `控制动作：${activeRun.controlState.action || 'unknown'}`, desc: activeRun.controlState.reason || '无补充说明', at: activeRun.controlState.updatedAt }] : []),
            ...(activeRun?.review ? [{ id: 'review-state', type: activeRun.review.action || 'review', title: `审批结果：${activeRun.review.action || 'pending'}`, desc: activeRun.review.note || '无审批备注', at: activeRun.review.createdAt }] : []),
            ...currentLogs.filter((item) => item.action || /审批|确认|回滚|暂停|恢复|review|control/i.test(item.message)).map((item) => ({ id: item.id, type: item.level, title: item.action || item.level, desc: item.message, at: item.at }))
        ];
        return items.slice(-8).reverse();
    }, [activeRun, currentLogs, currentTrace]);

    const load = useCallback(async () => {
        const [blueprintResult, sessionResult, runResult, evalResult] = await Promise.all([
            getAgentStudioBlueprint(),
            sessionService.listAgentStudioSessions(),
            listAgentStudioRuns(),
            loadEvalCases()
        ]);
        setBlueprint(blueprintResult);
        setRuns(runResult.runs || []);
        setCases(evalResult.cases || []);
        const latestRun = runResult.runs?.[0];
        if (latestRun) {
            setActiveRun((current) => current || latestRun);
            setTrace((items) => items.length ? items : latestRun.trace || []);
            setSources((items) => items.length ? items : latestRun.sources || []);
            setArtifacts((items) => items.length ? items : latestRun.artifacts || []);
            setPlan((items) => items.length ? items : latestRun.plan || []);
            setLogs((items) => items.length ? items : latestRun.logs || []);
            setAnswer((current) => current || latestRun.answer || '');
            setRunState((current) => current.runId ? current : { status: latestRun.status || 'completed', label: `已加载最新 Run：${latestRun.status || 'unknown'}`, runId: latestRun._id, intent: latestRun.intent, selectedSkill: latestRun.selectedSkill, plan: latestRun.plan });
        }
        if (sessionResult.sessions?.length) { setSessions(sessionResult.sessions); setActive((current) => current || sessionResult.sessions[0]); }
        else { const created = await sessionService.createAgentStudioSession('Agent Runtime 首次会话'); setSessions([created.session]); setActive(created.session); }
    }, [loadEvalCases, setCases, setSessions]);

    const refreshBlueprint = useCallback(async () => {
        setBlueprint(await getAgentStudioBlueprint() as Blueprint);
    }, []);

    useEffect(() => { load().catch(console.error); }, [load]);
    useEffect(() => subscribeRuntimeModelSettingsChanged(() => {
        void refreshBlueprint().catch((error) => console.warn('[AgentStudio] runtime blueprint refresh failed:', error));
    }), [refreshBlueprint]);
    useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [currentLogs.length, answer, running]);

    function hydrateRun(run: AgentRun) {
        setActiveRun(run); setTrace(run.trace || []); setSources(run.sources || []); setArtifacts(run.artifacts || []); setPlan(run.plan || []); setLogs(run.logs || []); setAnswer(run.answer || '');
        setRunState({ status: run.status || 'completed', label: `已加载 Run：${run.status}`, runId: run._id, intent: run.intent, selectedSkill: run.selectedSkill, plan: run.plan });
    }

    async function createSession() {
        const created = await sessionService.createAgentStudioSession('新的 Agent Runtime 会话');
        setSessions((items) => [created.session, ...items]); setActive(created.session); setActiveRun(null); setTrace([]); setSources([]); setArtifacts([]); setPlan([]); setLogs([]); setAnswer(''); setRunState({ status: 'idle', label: '等待运行' });
    }

    async function refreshRuns(nextRun?: AgentRun) {
        const result = await listAgentStudioRuns();
        setRuns(result.runs || []);
        if (nextRun) hydrateRun(nextRun);
    }

    async function runAgent(nextMessage = message, evalCaseId?: string) {
        if (!active || !nextMessage.trim() || running) return;
        const controller = new AbortController();
        abortRef.current = controller;
        setRunning(true); setAnswer(''); setTrace([]); setSources([]); setArtifacts([]); setPlan([]); setLogs([]); setActiveRun(null); setRunState({ status: 'intent_detected', label: '意图识别中' });
        const userMessage: AgentMessage = { id: createLocalMessageId('user'), role: 'user', content: nextMessage };
        const assistantMessage: AgentMessage = { id: createLocalMessageId('assistant'), role: 'assistant', content: '' };
        setActive({ ...active, messages: [...(active.messages || []), userMessage, assistantMessage] });
        try {
            await start(active._id, { message: nextMessage, evalCaseId }, {
                run_status: (payload) => setRunState(payload),
                plan: (payload) => { setPlan(payload.plan || []); setRunState((current) => ({ ...current, intent: payload.intent, selectedSkill: payload.selectedSkill, plan: payload.plan })); },
                trace: (payload) => setTrace((items) => [...items.filter((item) => item.id !== payload.id), payload]),
                sources: (payload) => setSources(payload.sources || []),
                artifacts: (payload) => setArtifacts(payload.artifacts || []),
                delta: (payload) => { setAnswer((current) => current + payload.text); setActive((current) => current ? { ...current, messages: current.messages.map((item) => item.id === assistantMessage.id ? { ...item, content: item.content + payload.text } : item) } : current); },
                final: async (payload) => {
                    setActiveRun(payload.run); setLogs(payload.run?.logs || []);
                    setRunState({ status: payload.run?.status || 'review_required', label: 'Run 已完成，等待审计/审批', runId: payload.run?._id, intent: payload.run?.intent, selectedSkill: payload.run?.selectedSkill, plan: payload.run?.plan });
                    const [sessionResult, runResult, evalResult] = await Promise.all([sessionService.listAgentStudioSessions(), listAgentStudioRuns(), evalCase.refresh()]);
                    setSessions(sessionResult.sessions || []); setRuns(runResult.runs || []); setCases(evalResult.cases || []);
                    const refreshed = sessionResult.sessions?.find((s: AgentSession) => s._id === active._id);
                    if (refreshed) setActive(refreshed);
                }
            }, controller.signal);
        } catch (error) { if ((error as Error).name !== 'AbortError') setRunState({ status: 'failed', label: (error as Error).message }); }
        finally { setRunning(false); abortRef.current = null; }
    }

    function stop() { abortRef.current?.abort(); setRunning(false); setRunState({ status: 'cancelled', label: '用户已停止' }); }

    async function control(action: 'pause' | 'resume' | 'rollback') { if (!activeRunId) return; const result = await controlRun(activeRunId, action, reviewNote); await refreshRuns(result.run); }
    async function review(action: 'confirm' | 'revise' | 'reject') { if (!activeRunId) return; const result = await reviewRun(activeRunId, action, reviewNote); await refreshRuns(result.run); }

    async function saveRunArtifact(artifact: Artifact, status = 'draft') { if (!activeRunId) return; const result = await updateArtifact(activeRunId, artifact, { content: artifact.content, status }); await refreshRuns(result.run); }
    async function confirmRunArtifact(artifact: Artifact) { if (!activeRunId) return; const result = await confirmArtifact(activeRunId, artifact, reviewNote); await refreshRuns(result.run); }
    async function exportRunArtifact(artifact: Artifact, format: 'markdown' | 'json') {
        if (!activeRunId) { await copyText(stringifyContent(artifact.content)); return; }
        const result = await exportArtifact(activeRunId, artifact, format); await copyText(result.content);
    }
    async function runEvalCase(item: EvalCase) { setMessage(item.prompt); await runAgent(item.prompt, item.id); }

    return (
        <section className="agentops-page">
            <Header title="Agent Runtime Console" desc="AgentOps 运行控制台：面向线上 Agent 的意图路由、计划编排、状态机、工具审计、人工审批、回滚与运行日志。" action={<Status status={running ? 'streaming' : runState.status} />} />
            <section className="agentops-hero">
                <div><span>AGENTOPS CONTROL PLANE</span><strong>配置模型 {blueprint?.runtime.llm.model || 'loading'} · Run 实际模型 {actualRunModel || '尚未运行'}{runUsedFallback ? '（备用）' : ''}</strong><p>{blueprint?.controls?.policy || 'Agent 控制动作会进入审计日志。'} 当前页面不再承担聊天主流程，而是负责运行治理、审计复盘和高风险控制。</p></div>
                <div className="agentops-health"><span><b>{opsMetrics.total}</b> Runs</span><span><b>{opsMetrics.sessions}</b> Sessions</span><span><b>{opsMetrics.waiting}</b> Waiting</span><span><b>{opsMetrics.failed}</b> Failed</span><span><b>{opsMetrics.avgLatency}ms</b> Avg latency</span></div>
            </section>
            <section className="agentops-runtime-grid">
                <article className={blueprint?.runtime.llm.mode === 'live' ? 'live' : 'fallback'}><span>当前配置模型</span><strong>{blueprint?.runtime.llm.provider || 'mock'} / {blueprint?.runtime.llm.model || 'deterministic'}</strong><p>{actualRunModel ? `本次 Run 实际模型：${actualRunModel}${runUsedFallback ? '（备用模型）' : '（主模型）'}` : (blueprint?.runtime.llm.configured ? '真实模型已配置，新 Run 将使用当前路由。' : '未配置真实模型 Key，运行会降级到本地 deterministic runtime。')}</p><em>{blueprint?.runtime.llm.mode || 'mock'}</em></article>
                <article className={blueprint?.runtime.rag.retrievalBackend === 'mongodb-atlas-vector-search' ? 'live' : 'fallback'}><span>Vector Store</span><strong>{blueprint?.runtime.rag.retrievalBackend || blueprint?.runtime.rag.vectorStore || 'local-hash'}</strong><p>{blueprint?.runtime.rag.productionReady ? 'MongoDB Atlas Vector Search 已作为检索后端。' : blueprint?.runtime.rag.error || '当前使用本地 hash fallback，需配置 Atlas URI 和 Vector Search Index。'}</p><em>{blueprint?.runtime.rag.mode || 'fallback'}</em></article>
                <article className={activeRun?.quality?.verdict === 'ready_for_review' ? 'live' : 'fallback'}><span>Run Quality</span><strong>{activeRun?.quality ? `${activeRun.quality.score}% · ${activeRun.quality.verdict}` : '等待 Run'}</strong><p>{activeRun?.quality ? `通过 ${activeRun.quality.passed}/${activeRun.quality.total} 项，平均引用分 ${activeRun.quality.avgCitationScore}` : '运行后展示引用命中、PRD、API、Trace 和 Provider 透明度。'}</p><em>{activeRun?.status || runState.status}</em></article>
            </section>
            <section className="agentops-command-strip">
                <div className="agentops-current-run"><span>当前运行</span><strong>{currentIntent?.label || (hasRunContext ? 'Agent Run 执行中' : '暂无活跃 Agent Run')}</strong><p>{hasRunContext ? `${currentSkill?.name || 'Runtime Router'} · ${runState.status} · ${blueprint?.runtime.rag.retrievalBackend || blueprint?.runtime.rag.vectorStore || 'Vector Store'}` : '运行 Agent 后这里会展示真实 Run ID、意图、Skill、Trace、Artifact 和质量评估。'}</p><div className="agentops-current-run-meta"><em>run {activeRun?.runId || runState.runId || 'not-started'}</em><em>confidence {Math.round((currentIntent?.confidence || 0) * 100)}%</em><em>{currentTrace.length} trace</em><em>{currentArtifacts.length} artifacts</em><em>{activeRun?.quality ? `${activeRun?.quality.score}% quality` : 'quality pending'}</em></div>{currentIntent?.signals?.length ? (<div className="agentops-current-signals">{currentIntent.signals.map((signal) => <b key={signal}>{signal}</b>)}</div>) : null}</div>
                <div><button className="primary-button" disabled={running || !message.trim()} onClick={() => runAgent()}><Send size={16} />运行 Agent</button><button className="secondary-button" disabled={!running} onClick={stop}><Pause size={16} />停止</button><button className="secondary-button" disabled={running || !message.trim()} onClick={() => runAgent(message)}><RefreshCw size={16} />重跑</button></div>
            </section>
            <div className="agentops-shell">
                <aside className="panel agentops-run-panel">
                    <div className="section-head"><div><h2>Run Registry</h2><p>按状态、意图和 Skill 检索历史运行。</p></div><button className="secondary-button compact" onClick={createSession}>新会话</button></div>
                    <input className="agentops-search" value={runSearch} placeholder="搜索 prompt / skill / status" onChange={(event) => setRunSearch(event.target.value)} />
                    <div className="agentops-filter">{['all', 'review_required', 'confirmed', 'failed', 'paused', 'rolled_back'].map((status) => (<button key={status} className={runFilter === status ? 'active' : ''} onClick={() => setRunFilter(status)}>{status}</button>))}</div>
                    <div className="agentops-run-list">{filteredRuns.slice(0, 12).map((run) => (<button key={run._id} className={activeRun?._id === run._id ? 'active' : ''} onClick={() => { hydrateRun(run); setDrawerOpen(true); }}><span className={`agentops-dot ${run.status}`} /><strong>{run.intent?.label || 'Agent Run'}</strong><em>{run.selectedSkill?.name || 'Runtime Router'}</em><small>{run.status} · {formatTime(run.createdAt)}</small><p>{run.prompt}</p></button>))}{!filteredRuns.length ? <div className="runtime-empty">暂无匹配 Run。运行 Agent 后会进入队列。</div> : null}</div>
                </aside>
                <main className="agentops-main">
                    <section className="panel agentops-command">
                        <div className="section-head"><div><h2>Command Center</h2><p>输入自然语言目标，Runtime 自动完成意图识别、Skill 路由、RAG、工具调用、LLM 生成和审批等待。</p></div><span className={`runtime-status-pill ${runState.status}`}>{runState.label}</span></div>
                        <div className="agentops-starters">{starterPrompts.map((item) => (<button key={item} onClick={() => setMessage(item)}>{item}</button>))}</div>
                        <textarea value={message} onChange={(event) => setMessage(event.target.value)} />
                    </section>
                    <section className="panel agentops-graph-panel">
                        <div className="section-head"><div><h2>Agent Execution Graph</h2><p>点击任意节点查看输入、输出、耗时、Token、错误和人工确认要求。</p></div><span>{currentTrace.length} trace steps</span></div>
                        <div className="agentops-graph">{graphNodes.map((node, index) => (<Fragment key={node.id}><button className={`agentops-node ${selectedNodeId === node.id ? 'active' : ''} ${node.trace?.status || 'pending'}`} onClick={() => setSelectedNodeId(node.id)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{node.label}</strong><em>{node.desc}</em><small>{node.trace?.status || 'pending'}</small></button>{index < graphNodes.length - 1 ? <i className={`agentops-graph-edge ${node.trace?.status || 'pending'}`} /> : null}</Fragment>))}</div>
                        <div className="agentops-statebar">{stateFlow.map((state, index) => (<span key={state} className={index <= stateIndex ? 'done' : ''}>{state}</span>))}</div>
                    </section>
                    <section className="agentops-overview-grid">
                        <article className="panel agentops-insight"><span>Intent Router</span><strong>{currentIntent?.label || '等待识别'}</strong><p>{currentIntent?.goal || 'Agent 会根据自然语言自动判断任务类型、知识范围和风险等级。'}</p><div>{currentIntent?.scopes?.map((scope) => <em key={scope}>{scope}</em>)}</div></article>
                        <article className="panel agentops-insight"><span>Skill Selection</span><strong>{currentSkill?.name || '等待路由'}</strong><p>{currentSkill?.description || 'Runtime 根据意图选择 SkillDefinition 和 allowedTools。'}</p><div>{currentSkill?.tools?.map((tool) => <em key={tool}>{tool}</em>)}</div></article>
                        <article className="panel agentops-insight"><span>Guardrails</span><strong>{currentIntent?.riskLevel || 'unknown'}</strong><p>高风险动作必须进入 human-in-the-loop，所有暂停、恢复、回滚和审批写入审计日志。</p><div><em>approval</em><em>rollback</em><em>audit log</em></div></article>
                    </section>
                    <section className="panel agentops-trend-panel">
                        <div className="section-head"><div><h2>Runtime Metrics</h2><p>基于真实 Run、Trace 和日志聚合，不使用静态 Mock 指标。</p></div><button className="secondary-button compact" disabled={!activeRun} onClick={() => setDrawerOpen(true)}>打开 Run Detail</button></div>
                        <div className="agentops-trend-grid">
                            <article><span>Latency Trend</span><strong>{opsMetrics.avgLatency}ms</strong><svg viewBox="0 0 320 92" role="img" aria-label="Agent latency trend"><polyline points={trend.latencyPath} /></svg></article>
                            <article><span>Token Usage</span><strong>{opsMetrics.totalTokens}</strong><svg viewBox="0 0 320 92" role="img" aria-label="Token usage trend"><polyline points={trend.tokenPath} /></svg></article>
                            <article><span>Run Quality</span><strong>{100 - trend.failureRate}%</strong><svg viewBox="0 0 320 92" role="img" aria-label="Run success trend"><polyline points={trend.successPath} /></svg></article>
                            <article className="agentops-slo-card"><span>Ops Baseline</span><strong>{trend.count || 0} samples</strong><p>等待审批 {opsMetrics.waiting} 个，失败 {opsMetrics.failed} 个，已确认 {opsMetrics.confirmed} 个。</p></article>
                        </div>
                    </section>
                    <section className="panel agentops-eval-panel">
                        <div className="section-head"><div><h2>Eval Quality Cases</h2><p>用真实产品场景验证引用命中、Artifact 完整度、API 合理性和 Trace 可复盘性。</p></div><span>{evalCases.filter((item) => item.lastResult?.verdict === 'ready_for_review').length} / {evalCases.length} ready</span></div>
                        <div className="agentops-eval-grid">{evalCases.map((item) => (<article key={item.id}><div><strong>{item.title}</strong><button className="secondary-button compact" disabled={running} onClick={() => void runEvalCase(item)}>运行 Case</button></div><p>{item.prompt}</p><div className="agentops-eval-tags">{item.expected.map((expected) => <span key={expected}>{expected}</span>)}</div><footer><span>{item.lastResult ? `${item.lastResult.score}%` : 'not run'}</span><em>{item.lastResult?.verdict || 'waiting'}</em></footer></article>))}</div>
                    </section>
                    <section className="panel agentops-plan-board">
                        <div className="section-head"><h2>Plan Board</h2><span>{currentPlan.length} planned steps</span></div>
                        <div className="agentops-plan-list">{currentPlan.map((item, index) => (<article key={item.id}><span className={`agentops-dot ${item.status}`} /><b>{String(index + 1).padStart(2, '0')}</b><div><strong>{item.name}</strong><p>{item.guardrail}</p></div><em>{item.owner}</em><small>{item.status}</small></article>))}{!currentPlan.length ? <div className="runtime-empty">运行后展示 Agent 自动规划步骤。</div> : null}</div>
                    </section>
                    <section className="agentops-lower-grid">
                        <article className="panel agentops-table-panel"><div className="section-head"><h2>Tool Call Audit</h2><span>{toolCalls.length}</span></div><div className="agentops-tool-table">{toolCalls.map((item) => (<button key={item.id} onClick={() => setSelectedNodeId(item.id)}><span className={`agentops-dot ${item.status}`} /><strong>{item.tool || item.name}</strong><em>{item.durationMs || 0}ms</em><small>{item.tokenUsage || 0} tokens</small></button>))}{!toolCalls.length ? <div className="runtime-empty">工具调用输入输出会在这里展开。</div> : null}</div></article>
                        <article className="panel agentops-log-panel"><div className="section-head"><h2>Audit Log</h2><span>{currentLogs.length}</span></div><div className="agentops-log-list" ref={logRef}>{currentLogs.map((log) => (<article key={log.id}><span>{log.level}</span><strong>{log.message}</strong><em>{formatTime(log.at)}</em></article>))}{!currentLogs.length ? <div className="runtime-empty">审计日志、降级、控制动作会记录在这里。</div> : null}</div></article>
                    </section>
                    <section className="panel agentops-transcript">
                        <div className="section-head"><h2>Transcript Snapshot</h2><span>{visibleMessages.length} messages</span></div>
                        <div className="runtime-message-list">{visibleMessages.map((item) => (<article key={item.id} className={item.role}><div className="runtime-message-avatar">{item.role === 'assistant' ? <Bot size={15} /> : 'U'}</div><div className="runtime-message-body"><header><strong>{item.role === 'assistant' ? 'AI Agent' : 'User Request'}</strong><span>{item.role === 'assistant' ? `${item.sources?.length || currentSources.length} citations` : 'input'}</span></header><MessageContent content={item.content} /><footer><button onClick={() => copyText(item.content)}><Copy size={13} />复制</button><button onClick={() => setMessage(item.content)}>回填输入</button></footer></div></article>))}{running ? <div className="runtime-thinking"><Sparkles size={16} /> Runtime 正在执行 Agent Graph...</div> : null}{!visibleMessages.length && !running ? <div className="runtime-empty">当前 Run 尚无对话记录。</div> : null}</div>
                    </section>
                </main>
                <aside className="agentops-detail-panel">
                    <section className="panel agentops-node-detail"><div className="section-head"><div><h2>Node Detail</h2><p>{selectedNode.owner}</p></div><span className={`runtime-status-pill ${selectedNode.trace?.status || 'pending'}`}>{selectedNode.trace?.status || 'pending'}</span></div><div className="agentops-node-summary"><strong>{selectedNode.label}</strong><p>{selectedNode.desc}</p><div><span>{selectedNode.trace?.durationMs || 0}ms</span><span>{selectedNode.trace?.tokenUsage || 0} tokens</span><span>{selectedNode.trace?.humanRequired ? 'human required' : 'auto'}</span></div></div><pre>{JSON.stringify({ input: selectedNode.trace?.input || null, output: selectedNode.trace?.output || null, error: selectedNode.trace?.error || null }, null, 2)}</pre></section>
                    <section className="panel agentops-trace-panel"><div className="section-head"><h2>Audit Timeline</h2><button className="secondary-button compact" disabled={!currentTrace.length} onClick={() => setOpenTraceIds((ids) => ids.length === currentTrace.length ? [] : currentTrace.map((item) => item.id))}>{!currentTrace.length ? '无 Trace' : openTraceIds.length === currentTrace.length ? '收起全部' : '全展开'}</button></div><div className="agentops-timeline">{currentTrace.map((item, index) => { const open = openTraceIds.includes(item.id); return (<article key={item.id}><button className={open ? 'active' : ''} onClick={() => setOpenTraceIds((ids) => ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id])}><span className={`agentops-dot ${item.status}`} />{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<strong>{index + 1}. {item.name}</strong><em>{item.durationMs || 0}ms · {item.tokenUsage || 0} tokens</em></button>{open ? <pre>{JSON.stringify({ input: item.input, output: item.output, error: item.error, durationMs: item.durationMs, tokenUsage: item.tokenUsage }, null, 2)}</pre> : null}</article>); })}{!currentTrace.length ? <div className="runtime-empty">运行后展示可审计 Trace。</div> : null}</div></section>
                    <section className="panel agentops-control"><h2>Run Control</h2><textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} /><div className="runtime-control-grid"><button className="secondary-button" disabled={!activeRunId || running} onClick={() => control('pause')}><Pause size={14} />暂停</button><button className="secondary-button" disabled={!activeRunId || running} onClick={() => control('resume')}><Play size={14} />恢复</button><button className="secondary-button" disabled={!activeRunId || running} onClick={() => control('rollback')}><RotateCcw size={14} />回滚</button></div><div className="runtime-review-grid"><button className="primary-button" disabled={!activeRunId || running} onClick={() => review('confirm')}><ShieldCheck size={14} />确认</button><button className="secondary-button" disabled={!activeRunId || running} onClick={() => review('revise')}>修改</button><button className="danger-button" disabled={!activeRunId || running} onClick={() => review('reject')}>拒绝</button></div></section>
                    <section className="panel agentops-approval-panel"><div className="section-head"><div><h2>Approval Timeline</h2><p>暂停、恢复、回滚和审批记录。</p></div><span>{approvalTimeline.length}</span></div><div className="agentops-approval-timeline">{approvalTimeline.map((item) => (<article key={item.id} className={item.type}><b /><div><strong>{item.title}</strong><p>{item.desc}</p><time>{formatDateTime(item.at)}</time></div></article>))}{!approvalTimeline.length ? <div className="runtime-empty">当前 Run 尚无人工审批或控制记录。</div> : null}</div></section>
                    <section className="panel agentops-side-list"><h2>Citations</h2><div className="runtime-source-list">{currentSources.map((source, index) => (<article key={source._id}><strong>[{index + 1}] {source.documentTitle}</strong><span>score {Number(source.score || 0).toFixed(4)} · {source.retrievalBackend || 'local'}</span>{source.sourcePath ? <code>{source.sourcePath}</code> : null}</article>))}{!currentSources.length ? <div className="runtime-empty">RAG 命中后展示引用来源。</div> : null}</div></section>
                    <section className="panel agentops-side-list"><h2>Artifacts</h2><div className="agentops-artifact-records">{currentArtifacts.map((artifact) => (<article key={artifact.id}><header><Workflow size={15} /><div><strong>{artifact.title}</strong><span>{artifact.type} · v{artifact.version || 1} · {artifact.reviewStatus || artifact.status}</span></div><em>{artifact.traceStepId || 'trace'}</em></header><pre>{stringifyContent(artifact.content)}</pre><footer><button onClick={() => copyText(stringifyContent(artifact.content))}>复制</button><button onClick={() => void saveRunArtifact(artifact, 'edited')}>保存版本</button><button onClick={() => void confirmRunArtifact(artifact)}>确认</button><button onClick={() => void exportRunArtifact(artifact, 'markdown')}>导出 MD</button><button onClick={() => void exportRunArtifact(artifact, 'json')}>导出 JSON</button></footer>{artifact.versions?.length ? (<details><summary>版本记录 · {artifact.versions.length}</summary>{artifact.versions.map((item) => (<span key={`${artifact.id}-${item.version}-${item.createdAt || item.at}`}>v{item.version} · {item.status} · {formatDateTime(item.createdAt || item.at)}</span>))}</details>) : null}</article>))}{!currentArtifacts.length ? <div className="runtime-empty">工具产物会在这里留档。</div> : null}</div></section>
                </aside>
            </div>
            <div className={`agentops-drawer-mask ${drawerOpen ? 'open' : ''}`} onClick={() => setDrawerOpen(false)}>
                <aside className="agentops-run-drawer" onClick={(event) => event.stopPropagation()}>
                    <header><div><span>RUN DETAIL</span><h2>{activeRun?.intent?.label || 'Agent Run Detail'}</h2><p>{activeRun?.prompt || '选择一个历史 Run 或运行 Agent 后查看完整详情。'}</p></div><button className="secondary-button compact" onClick={() => setDrawerOpen(false)}>关闭</button></header>
                    <nav className="agentops-drawer-tabs">{[['overview', '概览'], ['trace', 'Trace'], ['artifacts', 'Artifacts'], ['raw', 'Raw JSON']].map(([key, label]) => (<button key={key} className={drawerTab === key ? 'active' : ''} onClick={() => setDrawerTab(key as typeof drawerTab)}>{label}</button>))}</nav>
                    {drawerTab === 'overview' ? (<><div className="agentops-drawer-grid"><article><span>Status</span><strong>{activeRun?.status || runState.status}</strong><p>{runState.label}</p></article><article><span>Intent</span><strong>{currentIntent?.label || '未识别'}</strong><p>{currentIntent?.goal || '暂无意图详情'}</p></article><article><span>Skill</span><strong>{currentSkill?.name || '未选择'}</strong><p>{currentSkill?.tools?.join(' / ') || '暂无工具链'}</p></article><article><span>Context</span><strong>{currentSources.length} citations</strong><p>{blueprint?.runtime.rag.vectorStore || 'Vector Store'}</p></article></div>{activeRun?.quality ? (<section className="agentops-quality-checks"><div><strong>{activeRun.quality.score}%</strong><span>{activeRun.quality.verdict} · {activeRun.quality.passed}/{activeRun.quality.total} passed</span></div><div>{activeRun.quality.checks.map((item) => (<article key={item.key} className={item.passed ? 'pass' : 'fail'}><b>{item.passed ? '✓' : '!'}</b><span>{item.label}</span><em>{item.value}</em></article>))}</div></section>) : null}</>) : null}
                    {drawerTab === 'trace' ? (<div className="agentops-drawer-trace">{currentTrace.map((item, index) => (<article key={item.id}><header><strong>{index + 1}. {item.name}</strong><span>{item.status} · {item.durationMs || 0}ms · {item.tokenUsage || 0} tokens</span></header><pre>{JSON.stringify({ input: item.input, output: item.output, error: item.error, tool: item.tool, humanRequired: item.humanRequired }, null, 2)}</pre></article>))}{!currentTrace.length ? <div className="runtime-empty">暂无 Trace。</div> : null}</div>) : null}
                    {drawerTab === 'artifacts' ? (<div className="agentops-drawer-artifacts">{currentArtifacts.map((artifact) => (<article key={artifact.id}><header><strong>{artifact.title}</strong><span>{artifact.type} · v{artifact.version || 1} · {artifact.reviewStatus || artifact.status}</span></header><div className="agentops-drawer-artifact-actions"><button onClick={() => copyText(stringifyContent(artifact.content))}>复制</button><button onClick={() => void confirmRunArtifact(artifact)}>确认</button><button onClick={() => void exportRunArtifact(artifact, 'markdown')}>导出 Markdown</button><button onClick={() => void exportRunArtifact(artifact, 'json')}>导出 JSON</button></div><pre>{stringifyContent(artifact.content)}</pre>{artifact.versions?.length ? (<div className="agentops-drawer-version-list">{artifact.versions.map((item) => <span key={`${artifact.id}-${item.version}`}>v{item.version} · {item.status}</span>)}</div>) : null}</article>))}{!currentArtifacts.length ? <div className="runtime-empty">暂无 Artifact。</div> : null}</div>) : null}
                    {drawerTab === 'raw' ? (<pre className="agentops-drawer-raw">{JSON.stringify(activeRun || { status: runState.status, intent: currentIntent, selectedSkill: currentSkill, plan: currentPlan, trace: currentTrace, sources: currentSources, artifacts: currentArtifacts, logs: currentLogs }, null, 2)}</pre>) : null}
                </aside>
            </div>
        </section>
    );
}
