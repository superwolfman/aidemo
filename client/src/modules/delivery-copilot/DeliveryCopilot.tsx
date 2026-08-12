import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from '../../components/ui';
import { ArtifactOverview } from './components/ArtifactOverview';
import { ArtifactWorkbench } from './components/ArtifactWorkbench';
import { KnowledgeContext } from './components/KnowledgeContext';
import { ApprovalPanel } from './components/ApprovalPanel';
import { SessionPanel } from './components/SessionPanel';
import { SkillSelector } from './components/SkillSelector';
import { StreamPanel } from './components/StreamPanel';
import { TraceTimeline } from './components/TraceTimeline';
import { CitationText } from './components/CitationText';
import type { AgentRun, AgentSession, Artifact, EvalCase, RuntimeBlueprint } from './types';
import { downloadFile, getRetrievalView, stringify } from './utils';
import { useAgentRun } from '../../hooks/useAgentRun';
import { useEval } from '../../hooks/useEval';
import { useArtifact } from '../../hooks/useArtifact';
import { useSession } from '../../hooks/useSession';
import { useTenantSessionState } from '../../hooks/useTenantSessionState';
import type { ShellContext } from '../../platform/subapps';
import { getAgentStudioBlueprint } from '../../services/blueprintService';
import * as sessionService from '../../services/sessionService';
import { getAgentStudioRun } from '../../services/agentRunService';
import { readBlueprintCache, writeBlueprintCache } from '../../services/blueprintCache';
import { subscribeRuntimeModelSettingsChanged } from '../../platform/runtimeModelEvents';

const deliveryTaskModes = [
    { id: 'product-workflow', title: '产品交付工作流', desc: '需求澄清、PRD、页面结构、接口协议和任务拆解', agentId: 'product-delivery-agent', scopes: ['architecture', 'standards', 'ai-native', 'frontend', 'frontend-observability', 'engineering-governance', 'performance'], promptSuffix: '请按产品交付工作流输出 PRD 摘要、页面结构、接口协议、状态流转、研发任务拆解、风险和待确认问题。' },
    { id: 'requirement-analysis', title: '架构级需求分析', desc: '拆目标、约束、风险、验收标准和待确认问题', agentId: 'product-delivery-agent', scopes: ['architecture', 'standards', 'frontend', 'frontend-observability', 'engineering-governance', 'performance'], promptSuffix: '请先做架构级需求分析，输出目标、非功能约束、风险、验收标准、待确认问题和下一步交付计划。' },
    { id: 'knowledge-assistant', title: '知识库问答方案', desc: '知识范围、RAG 引用、纠错反馈和运营治理', agentId: 'knowledge-assistant', scopes: ['architecture', 'standards', 'ai-native', 'im', 'frontend-observability', 'engineering-governance', 'performance'], promptSuffix: '请围绕知识库问答产品输出知识范围、RAG 检索链路、引用来源展示、人工纠错、会话历史和质量评估方案。' },
    { id: 'delivery-review', title: '交付质量评审', desc: '测试策略、上线风险、质量门禁和人工审批', agentId: 'delivery-review-agent', scopes: ['standards', 'architecture', 'sdk', 'frontend-observability', 'engineering-governance', 'performance'], promptSuffix: '请对本需求做交付质量评审，输出测试策略、风险清单、上线门禁、缺口和人工审批建议。' }
];

export default function DeliveryCopilot({ shell }: { shell: ShellContext }) {
    const tenantId = shell?.user?.tenant?.id || shell?.user?.activeTenantId || shell?.user?.tenantId || '';
    const userId = String(shell?.user?._id || '');
    const sessionState = useTenantSessionState(tenantId, userId);

    const [blueprint, setBlueprint] = useState<RuntimeBlueprint | null>(null);
    const [requirement, setRequirement] = useState('为企业内部 AI 产品研发团队建设一个需求到交付 Copilot 工作台，要求覆盖 PRD、页面结构、BFF 接口协议、任务拆解、风险确认和人工审批。');
    const [audience, setAudience] = useState('产品经理、前端工程师、后端工程师、测试负责人');
    const [deadline, setDeadline] = useState('3 个工作日内完成可演示 MVP');
    const [constraints, setConstraints] = useState('React + TypeScript + Node BFF；必须展示 RAG 引用、Trace、人工确认和导出产物。');
    const [taskModeId, setTaskModeId] = useState(deliveryTaskModes[0].id);
    const [selectedEvalCaseId, setSelectedEvalCaseId] = useState('ai-product-workflow');
    const [activeArtifactId, setActiveArtifactId] = useState('');
    const [artifactDraft, setArtifactDraft] = useState('');
    const [running, setRunning] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const outputRef = useRef<HTMLDivElement | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [notice, setNotice] = useState('');
    const loadedRef = useRef(false);
    const activeRole = shell?.user?.tenant?.role || shell?.user?.role;
    const permissions = shell?.user?.permissions;
    const isDemoViewer = permissions?.mode === 'restricted-demo' || activeRole === 'demo_viewer';
    const artifactsReadOnly = permissions?.canEditArtifacts === false || isDemoViewer;

    const session = useSession();
    const agentRun = useAgentRun('delivery');
    const evalCase = useEval('agent-studio');
    const artifact = useArtifact();

    const { setActive, active } = session;
    const { status, setStatus, answer, setAnswer, trace, setTrace, sources, setSources, filteredChunks, setFilteredChunks, ragDiagnostics, setRagDiagnostics, artifacts, setArtifacts, quality, setQuality, activeRun, setActiveRun, start } = agentRun;
    const { cases, setCases, load: loadEvalCases, refresh: refreshEval } = evalCase;

    const activeArtifact = useMemo(() => artifacts.find((item) => item.id === activeArtifactId) || artifacts[0], [activeArtifactId, artifacts]);
    const activeTaskMode = useMemo(() => deliveryTaskModes.find((item) => item.id === taskModeId) || deliveryTaskModes[0], [taskModeId]);
    // 配置快照作为初始值；本次 Run 的真实检索状态通过 SSE diagnostics 实时覆盖。
    const ragRuntime = useMemo(() => ({
        ...blueprint?.runtime.rag,
        ...(ragDiagnostics?.status || {})
    }), [blueprint?.runtime.rag, ragDiagnostics?.status]);
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
            const art = artifacts.find((item) => item.type === slot.type);
            return { ...slot, artifact: art, done: Boolean(art), confirmed: art?.status === 'confirmed' };
        });
    }, [artifacts]);
    const load = useCallback(async () => {
        try {
            // 仅缓存租户隔离的稳定 Blueprint；动态 LLM 路由始终从服务端获取。
            const cachedBlueprint = readBlueprintCache<RuntimeBlueprint>(tenantId);
            if (cachedBlueprint) setBlueprint(cachedBlueprint);

            const [blueprintResult, sessionResult, caseResult] = await Promise.all([
                getAgentStudioBlueprint(),
                sessionService.listAgentStudioSessions(),
                loadEvalCases()
            ]);
            setBlueprint(blueprintResult);
            writeBlueprintCache(tenantId, blueprintResult);
            setCases(caseResult.cases || []);

            // Keep Alive：优先恢复上次的 active session
            const snapshot = sessionState.getSnapshot();
            if (snapshot?.activeSessionId) {
                const target = sessionResult.sessions?.find((s: AgentSession) => s._id === snapshot.activeSessionId);
                if (target) {
                    setActive(target);
                    return;
                }
            }

            if (sessionResult.sessions?.[0]) {
                setActive(sessionResult.sessions[0]);
                return;
            }
            const created = await sessionService.createAgentStudioSession('Copilot 交付工作台会话');
            setActive(created.session);
        } finally {
            loadedRef.current = true;
        }
    }, [loadEvalCases, setCases, setActive, sessionState, tenantId]);

    const refreshBlueprint = useCallback(async () => {
        const next = await getAgentStudioBlueprint();
        setBlueprint(next);
        writeBlueprintCache(tenantId, next);
    }, [tenantId]);

    useEffect(() => { load().catch(console.error); }, [load]);
    useEffect(() => subscribeRuntimeModelSettingsChanged(() => {
        void refreshBlueprint().catch((error) => console.warn('[DeliveryCopilot] runtime blueprint refresh failed:', error));
    }), [refreshBlueprint]);
    useEffect(() => { if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight; }, [answer, running]);

    // Keep Alive：session 加载完成后恢复 run 与视图状态
    const restoredRef = useRef(false);
    useEffect(() => {
        if (!tenantId || !userId || !active?._id || restoredRef.current) return;
        const snapshot = sessionState.getSnapshot();
        if (!snapshot) return;

        const restore = async () => {
            try {
                restoredRef.current = true;
                if (snapshot.taskModeId) setTaskModeId(snapshot.taskModeId);
                if (snapshot.selectedEvalCaseId !== undefined) setSelectedEvalCaseId(snapshot.selectedEvalCaseId);
                if (snapshot.requirement) setRequirement(snapshot.requirement);
                if (snapshot.audience) setAudience(snapshot.audience);
                if (snapshot.deadline) setDeadline(snapshot.deadline);
                if (snapshot.constraints) setConstraints(snapshot.constraints);

                if (snapshot.activeRunId) {
                    const { run } = await getAgentStudioRun(snapshot.activeRunId);
                    if (run) {
                        syncRun(run);
                        if (snapshot.activeArtifactId) {
                            const art = (run.artifacts || []).find((item: Artifact) => item.id === snapshot.activeArtifactId) || run.artifacts?.[0];
                            if (art) {
                                setActiveArtifactId(art.id);
                                setArtifactDraft(stringify(art.content));
                            }
                        }
                    }
                }
            } catch (error) {
                console.warn('[KeepAlive] restore run failed:', error);
            }
        };

        restore();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active?._id, tenantId, userId]);

    // Keep Alive：关键状态变更时保存快照
    useEffect(() => {
        if (!tenantId || !userId || !loadedRef.current) return;
        sessionState.setSnapshot({
            activeSessionId: active?._id,
            activeRunId: activeRun?._id,
            activeArtifactId,
            taskModeId,
            selectedEvalCaseId,
            requirement,
            audience,
            deadline,
            constraints
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active?._id, activeRun?._id, activeArtifactId, taskModeId, selectedEvalCaseId, requirement, audience, deadline, constraints, tenantId, userId]);

    async function run(opts: {
        requirement?: string;
        audience?: string;
        deadline?: string;
        constraints?: string;
        evalCaseId?: string;
    } = {}) {
        if (!active || running) return;
        const req = opts.requirement ?? requirement;
        const aud = opts.audience ?? audience;
        const dl = opts.deadline ?? deadline;
        const cons = opts.constraints ?? constraints;
        // RAG 只使用用户的核心业务需求；受众、期限、技术约束仍进入 LLM Prompt，
        // 但不再污染语义检索（否则 React/Node/RAG/Trace 会把 Copilot 自身源码推到前列）。
        const retrievalQuery = req.trim();
        const nextPrompt = [
            `业务需求：${req}`,
            `目标用户：${aud}`,
            `交付目标：${dl}`,
            `约束条件：${cons}`,
            activeTaskMode.promptSuffix
        ].join('\n');
        const evalCaseId = opts.evalCaseId ?? selectedEvalCaseId;
        if (!retrievalQuery) return;
        const controller = new AbortController();
        abortRef.current = controller;
        setRunning(true);
        setAnswer('');
        setSources([]);
        setFilteredChunks([]);
        setRagDiagnostics(null);
        setArtifacts([]);
        setTrace([]);
        setQuality(null);
        // 新 Run 尚未返回真实 provider，避免继续显示上一条历史 Run 的模型。
        setActiveRun(null);
        setStatus('validating');
        setNotice('');
        try {
            await start(active._id, {
                message: nextPrompt,
                retrievalQuery,
                evalCaseId,
                commandOptions: { agentId: activeTaskMode.agentId, scopes: activeTaskMode.scopes, taskModeId: activeTaskMode.id, source: 'delivery-copilot' }
            }, {
                run_status: (payload) => setStatus(payload.status || 'running'),
                trace: (payload) => setTrace((items) => [...items.filter((item) => item.id !== payload.id), payload]),
                sources: (payload) => {
                    setSources(payload.sources || []);
                    setFilteredChunks(payload.filteredChunks || []);
                    setRagDiagnostics(payload.diagnostics || null);
                },
                artifacts: (payload) => { setArtifacts(payload.artifacts || []); setActiveArtifactId(payload.artifacts?.[0]?.id || ''); setArtifactDraft(stringify(payload.artifacts?.[0]?.content || '')); },
                delta: (payload) => setAnswer((current) => current + payload.text),
                error: (payload) => {
                    setStatus('failed');
                    setNotice(`运行失败：${payload.message || 'Agent Run 执行失败'}`);
                },
                final: (payload: { run: AgentRun }) => {
                    setStatus(payload.run?.status || 'review_required');
                    setAnswer(payload.run?.answer || '');
                    setSources(payload.run?.sources || []);
                    setFilteredChunks(payload.run?.filteredChunks || []);
                    setRagDiagnostics(payload.run?.ragDiagnostics || null);
                    setArtifacts(payload.run?.artifacts || []);
                    // 防御性合并：后端 final 事件可能不带 trace，避免覆盖运行中已累积的 trace
                    setTrace((items) => (payload.run?.trace?.length ? payload.run.trace : items));
                    setQuality(payload.run?.quality || null);
                    setActiveRun(payload.run || null);
                    setActiveArtifactId(payload.run?.artifacts?.[0]?.id || '');
                    setArtifactDraft(stringify(payload.run?.artifacts?.[0]?.content || ''));
                    // Run 主链路已经在服务端生成并持久化 quality/evalResult。
                    // 这里只刷新 Eval Case 展示，避免再发起一次有副作用的重复评分请求。
                    if (evalCaseId) {
                        void refreshEvalCases().catch((error) => {
                            console.warn('Eval cases refresh failed', error);
                            setNotice('Run 已完成并保存，但评估列表刷新失败，可稍后刷新页面重试。');
                        });
                    }
                    if (isDemoViewer) {
                        setNotice('受限 Demo Run 已完成：本次生成结果可查看；编辑、确认、导出和复评分不可用。');
                    }
                }
            }, controller.signal);
        } catch (error) {
            if (!controller.signal.aborted) { setStatus('failed'); setAnswer(`运行失败：${(error as Error).message}`); }
        } finally { setRunning(false); abortRef.current = null; }
    }

    function stop() { abortRef.current?.abort(); setRunning(false); setStatus('cancelled'); }

    function applyCase(item: EvalCase) {
        if (running) return;
        setSelectedEvalCaseId(item.id);
        setRequirement(item.prompt);
        setConstraints(`验收重点：${item.expected.join('、')}`);
    }

    async function refreshEvalCases() { await refreshEval(); }

    async function copy(text: string) { await navigator.clipboard?.writeText(text); }

    function selectArtifact(art: Artifact) { setActiveArtifactId(art.id); setArtifactDraft(stringify(art.content)); }

    function syncRun(run: AgentRun) {
        setActiveRun(run);
        setStatus(run.status || status);
        setArtifacts(run.artifacts || []);
        setTrace(run.trace || []);
        setSources(run.sources || []);
        setFilteredChunks(run.filteredChunks || []);
        setRagDiagnostics(run.ragDiagnostics || null);
        setQuality(run.quality || null);
        const nextArtifact = (run.artifacts || []).find((item) => item.id === activeArtifactId) || run.artifacts?.[0];
        if (nextArtifact) { setActiveArtifactId(nextArtifact.id); setArtifactDraft(stringify(nextArtifact.content)); }
    }

    async function saveArtifact() {
        if (!activeRun?._id || !activeArtifact) return;
        const result = await artifact.update(activeRun._id, activeArtifact, { content: artifactDraft, status: 'editing', reviewStatus: 'pending' });
        syncRun(result);
    }
    async function confirmArtifact() {
        // if (!activeRun?._id || !activeArtifact) return;
        // const result = await artifact.confirm(activeRun._id, activeArtifact, 'Copilot 交付工作台确认该 Artifact 可进入下一阶段。');
        // syncRun(result);
        if (!activeRun?._id || !activeArtifact || confirming || activeArtifact.status === 'confirmed' || activeArtifact.reviewStatus === 'confirmed') return;
        setConfirming(true);
        try {
            const result = await artifact.confirm(activeRun._id, activeArtifact, 'Copilot 交付工作台确认该 Artifact 可进入下一阶段。');
            syncRun(result);
        } finally {
            setConfirming(false);
        }
    }
    async function reviewArtifact() {
        if (!activeRun?._id || !activeArtifact) return;
        const result = await artifact.review(activeRun._id, activeArtifact, '提交人工评审。');
        syncRun(result);
    }
    async function exportArtifact(format: 'markdown' | 'json') {
        if (!activeRun?._id || !activeArtifact) return;
        const result = await artifact.exportFile(activeRun._id, activeArtifact, format);
        downloadFile(result.filename || `${activeArtifact.type}.${format === 'json' ? 'json' : 'md'}`, result.content || '', format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8');
        if (result.run) syncRun(result.run);
    }

    return (
        <div className="delivery-page">
            <div className="product-page-kicker">Delivery Copilot Workbench</div>
            <Header title="Copilot 交付工作台" desc="面向业务交付：从需求输入、RAG 上下文、流式分析到 PRD / 页面结构 / API / 任务拆解 Artifact。" />
            {isDemoViewer ? (
                <div className="delivery-access-notice" role="status">
                    <strong>受限演示模式</strong>
                    <span>可创建限额 Demo Run 并查看本次生成的 RAG、Trace 和 Artifact；不可编辑、确认、导出或复评分。</span>
                </div>
            ) : null}
            {notice ? <div className="delivery-run-notice" role="status">{notice}</div> : null}
            <SessionPanel blueprint={blueprint} activeRun={activeRun} ragRuntime={ragRuntime} ragLive={ragLive} quality={quality} />
            <ArtifactOverview artifactSummary={artifactSummary} activeArtifactId={activeArtifact?.id} onSelectArtifact={selectArtifact} />
            <main className="delivery-workspace delivery-workspace-v2">
                <section className="delivery-workspace-col delivery-workspace-left">
                    <SkillSelector taskModes={deliveryTaskModes} taskModeId={taskModeId} onTaskModeChange={setTaskModeId} requirement={requirement} audience={audience} deadline={deadline} constraints={constraints} onRequirementChange={setRequirement} onAudienceChange={setAudience} onDeadlineChange={setDeadline} onConstraintsChange={setConstraints} cases={cases} selectedEvalCaseId={selectedEvalCaseId} onApplyCase={applyCase} running={running} onRun={() => run()} onStop={stop} onRerun={() => run()} />
                </section>
                <section className="delivery-workspace-col delivery-workspace-center">
                    <section className="delivery-im-region">
                        <div className="chat-message user"><div className="chat-role">U</div><div className="markdown-body">{requirement || '（未填写需求）'}</div></div>
                        {answer ? (<div className="chat-message assistant"><div className="chat-role">AI</div><div className="markdown-body"><CitationText text={answer} sourceCount={sources.length} /></div></div>) : null}
                    </section>
                    <section className="delivery-stream-region">
                        <StreamPanel status={status} running={running} trace={trace} answer={answer} sourceCount={sources.length} outputRef={outputRef} />
                    </section>
                </section>
                <section className="delivery-workspace-col delivery-workspace-right">
                    <TraceTimeline trace={trace} status={status} />
                </section>
            </main>
            <section className="delivery-bottom-row">
                <section className="delivery-region-4">
                    <KnowledgeContext ragLive={ragLive} ragRuntime={ragRuntime} retrievalView={retrievalView} requirement={requirement} sources={sources} filteredChunks={filteredChunks} diagnostics={ragDiagnostics} trace={trace} />
                </section>
                <section className="delivery-region-5">
                    <ApprovalPanel activeRun={activeRun} activeArtifact={activeArtifact} artifactSummary={artifactSummary} onSelectArtifact={selectArtifact} onConfirmArtifact={confirmArtifact} readOnly={permissions?.canReviewArtifacts === false || isDemoViewer} />
                </section>
            </section>
            <ArtifactWorkbench artifacts={artifacts} activeArtifact={activeArtifact} activeRun={activeRun} artifactDraft={artifactDraft} onArtifactDraftChange={setArtifactDraft} onSelectArtifact={selectArtifact} onCopy={copy} onSaveArtifact={saveArtifact} onConfirmArtifact={confirmArtifact} onReviewArtifact={reviewArtifact} onExportArtifact={exportArtifact} readOnly={artifactsReadOnly} />
        </div>
    );
}
