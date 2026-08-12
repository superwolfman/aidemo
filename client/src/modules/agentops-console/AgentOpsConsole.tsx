import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from '../../components/ui';
import { CommandCenter } from './components/CommandCenter';
import { MetricsGrid, RuntimeMetrics } from './components/RuntimeMetrics';
import { RunDetailDock } from './components/RunDetailDock';
import { RunDetailDrawer } from './components/RunDetailDrawer';
import { RunRegistry } from './components/RunRegistry';
import { RuntimeSummary } from './components/RuntimeSummary';
import { StateMachinePanel } from './components/StateMachinePanel';
import { TraceAuditPanel } from './components/TraceAuditPanel';
import { ModelSettingsPanel } from './components/ModelSettingsPanel';
import { useSession } from '../../hooks/useSession';
import { useAgentRun } from '../../hooks/useAgentRun';
import { getAgentStudioBlueprint } from '../../services/blueprintService';
import * as sessionService from '../../services/sessionService';
import * as agentRunService from '../../services/agentRunService';
import { getAgentStudioRun } from '../../services/agentRunService';
import { useTenantSessionState } from '../../hooks/useTenantSessionState';
import type { ShellContext } from '../../platform/subapps';

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

type RagRuntime = Blueprint['runtime']['rag'];
type RunSource = NonNullable<AgentRun['sources']>[number];

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

function isLiveVectorSource(source: RunSource) {
    return source.retrievalBackend === 'mongodb-atlas-vector-search';
}

function isFallbackSource(source: RunSource) {
    const backend = source.retrievalBackend || '';
    return backend === 'local' || backend === 'local-hash' || backend.includes('fallback');
}

function getRunRetrievalView(ragRuntime: RagRuntime | undefined, currentSources: RunSource[] = []) {
    const hasRunSources = currentSources.length > 0;
    const runLive = hasRunSources && currentSources.every(isLiveVectorSource);
    const runFallback = hasRunSources && currentSources.some(isFallbackSource);
    const configuredLive = Boolean(ragRuntime?.productionReady && ragRuntime?.retrievalBackend === 'mongodb-atlas-vector-search');
    const backend = hasRunSources
        ? (currentSources[0]?.retrievalBackend || 'unknown')
        : (ragRuntime?.retrievalBackend || ragRuntime?.backend || ragRuntime?.vectorStore || 'retrieval loading');

    return {
        live: hasRunSources ? runLive : configuredLive,
        backend,
        label: hasRunSources
            ? (runLive ? 'current run live vector' : (runFallback ? 'current run fallback retrieval' : 'current run backend unknown'))
            : (configuredLive ? 'live vector configured' : 'fallback / not verified'),
        message: hasRunSources && !runLive
            ? '当前选中 Run 使用降级检索，审计视图不会把它标记为真实向量链路。'
            : ''
    };
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

export default function AgentOpsConsole({ shell }: { shell: ShellContext }) {
    const tenantId = shell?.user?.tenant?.id || shell?.user?.activeTenantId || shell?.user?.tenantId || '';
    const userId = String(shell?.user?._id || '');
    const activeRole = shell?.user?.tenant?.role || shell?.user?.role;
    const permissions = shell?.user?.permissions;
    const isDemoViewer = permissions?.mode === 'restricted-demo' || activeRole === 'demo_viewer';
    const canControlRuns = permissions?.canControlRuns !== false && !isDemoViewer;
    const canReplayRuns = permissions?.canReplayRuns !== false && !isDemoViewer;
    const canReviewRuns = permissions?.canReviewRuns !== false && !isDemoViewer;
    const canManageRuntimeModels = permissions?.canManageRuntimeModels === true || ['admin', 'owner'].includes(String(activeRole));
    const [consoleView, setConsoleView] = useState<'runs' | 'models'>('runs');
    const tenantSessionState = useTenantSessionState(tenantId, userId);
    const session = useSession();
    const agentRun = useAgentRun('agent-studio');
    const { sessions, setSessions, active, setActive, load: loadSession, create: createSessionSvc } = session;
    const { running, setRunning, start, abortRef } = agentRun;
    const [acting, setActing] = useState(false);

    const [blueprint, setBlueprint] = useState<any>(null);
    const [activeRunId, setActiveRunId] = useState('');
    const [activeTraceId, setActiveTraceId] = useState('');
    const [filter, setFilter] = useState('all');
    const [keyword, setKeyword] = useState('');
    const [command, setCommand] = useState('');
    const [selectedAgentId, setSelectedAgentId] = useState('product-delivery-agent');
    const [selectedScopes, setSelectedScopes] = useState<string[]>(['architecture', 'standards', 'ai-native', 'frontend']);
    const [controlNote, setControlNote] = useState('运行治理确认：保留审计日志后进入下一步。');
    const [detailOpen, setDetailOpen] = useState(false);
    const [detailTab, setDetailTab] = useState<'overview' | 'trace' | 'artifacts' | 'sources' | 'raw'>('overview');
    const [runs, setRuns] = useState<AgentRun[]>([]);
    const activeRunIdRef = useRef(activeRunId);
    useEffect(() => { activeRunIdRef.current = activeRunId; }, [activeRunId]);


    const activeRunMemo = useMemo(() => runs.find((run) => run._id === activeRunId) || runs[0], [activeRunId, runs]);
    const selectedAgent = useMemo(() => blueprint?.capabilities?.find((item) => item.id === selectedAgentId) || blueprint?.capabilities?.[0], [blueprint, selectedAgentId]);
    const ragRuntime = blueprint?.runtime.rag;
    const activeSources = useMemo(() => activeRunMemo?.sources || [], [activeRunMemo]);
    const retrievalView = useMemo(() => getRunRetrievalView(ragRuntime, activeSources), [ragRuntime, activeSources]);
    const ragLive = retrievalView.live;
    const trace = useMemo(() => activeRunMemo?.trace || [], [activeRunMemo]);
    const latestTraceById = useMemo(() => { const map = new Map<string, any>(); trace.forEach((item) => map.set(item.id, item)); return map; }, [trace]);
    const stateSteps = useMemo(() => stateOrder.map((state) => latestTraceById.get(state.id) || { id: state.id, name: state.label, status: 'pending' as const }), [latestTraceById]);
    const activeTrace = trace.find((item) => item.id === activeTraceId) || trace[0];
    const selectedScopeLabels = useMemo(() => scopeOptions.filter((scope) => selectedScopes.includes(scope.id)).map((scope) => scope.label), [selectedScopes]);
    const filteredRuns = useMemo(() => runs.filter((run) => { const hitStatus = filter === 'all' || run.status === filter; const text = [run.prompt, run.status, run.intent?.label, run.selectedSkill?.name].join(' ').toLowerCase(); return hitStatus && (!keyword.trim() || text.includes(keyword.trim().toLowerCase())); }), [filter, keyword, runs]);
    const metrics = useMemo(() => {
        const allTrace = runs.flatMap((run) => run.trace || []);
        const failed = runs.filter((run) => run.status === 'failed' || run.trace?.some((item) => item.status === 'failed')).length;
        const waiting = runs.filter((run) => ['review_required', 'paused', 'waiting'].includes(run.status)).length;
        const latency = allTrace.reduce((sum, item) => sum + (item.durationMs || 0), 0);
        const tokens = allTrace.reduce((sum, item) => sum + (item.tokenUsage || 0), 0);
        const qualityRuns = runs.filter((run) => run.quality);
        const quality = qualityRuns.reduce((sum, run) => sum + (run.quality?.score || 0), 0);
        const confirmed = runs.filter((run) => ['confirmed', 'completed'].includes(run.status)).length;
        return { total: runs.length, failed, waiting, confirmed, avgLatency: allTrace.length ? Math.round(latency / allTrace.length) : 0, tokens, assessed: qualityRuns.length, avgQuality: qualityRuns.length ? Math.round(quality / qualityRuns.length) : 0 };
    }, [runs]);
    const trendPath = useMemo(() => buildSparkline(runs.slice(0, 12).reverse().map((run) => (run.trace || []).reduce((sum, item) => sum + (item.durationMs || 0), 0))), [runs]);
    const metricTrends = useMemo(() => { const sample = runs.slice(0, 12).reverse(); return { latency: buildSparkline(sample.map((run) => (run.trace || []).reduce((sum, item) => sum + (item.durationMs || 0), 0))), tokens: buildSparkline(sample.map((run) => (run.trace || []).reduce((sum, item) => sum + (item.tokenUsage || 0), 0))), quality: buildSparkline(sample.map((run) => run.quality?.score || 0)) }; }, [runs]);

    const load = useCallback(async () => {
        const [blueprintResult, runResult, sessionResult] = await Promise.all([getAgentStudioBlueprint(), agentRunService.listRuns(), sessionService.listAgentStudioSessions()]);
        setBlueprint(blueprintResult);
        setRuns(runResult.runs || []);
        if (sessionResult.sessions?.[0]) setActive(sessionResult.sessions[0]);
        else { const created = await sessionService.createAgentStudioSession('AgentOps Command Center 会话'); setActive(created.session); }
        const first = runResult.runs?.[0];
        const linkedRunId = tenantSessionState.getSnapshot()?.activeRunId;
        const selected = runResult.runs?.find((run: AgentRun) => run._id === activeRunIdRef.current)
            || runResult.runs?.find((run: AgentRun) => run._id === linkedRunId)
            || first;
        if (selected) {
            setActiveRunId(selected._id);
            setActiveTraceId((current) => current || selected.trace?.[0]?.id || '');
            tenantSessionState.setSnapshot({ activeRunId: selected._id, runId: selected.runId });
        }

        // 列表接口出于性能排除 trace/artifacts/logs，若当前有选中的 run，补全详情避免显示空 Trace
        const targetId = selected?._id;
        if (targetId) {
            try {
                const { run } = await getAgentStudioRun(targetId);
                if (run) {
                    setRuns((items) => items.map((item) => (item._id === run._id ? run : item)));
                }
            } catch (error) {
                console.warn('[AgentOps] hydrate active run failed:', error);
            }
        }
    }, [setActive, setRuns, setBlueprint, tenantSessionState]);

    useEffect(() => { load().catch(console.error); }, [load]);

    // 列表接口不返回 trace/artifacts/logs，选中 run 后通过详情接口补全，避免运行完后被列表覆盖导致 Trace 为空
    useEffect(() => {
        if (!activeRunId) return;
        let cancelled = false;
        getAgentStudioRun(activeRunId)
            .then(({ run }) => {
                if (cancelled || !run) return;
                setRuns((items) => items.map((item) => (item._id === run._id ? run : item)));
            })
            .catch((error) => console.warn('[AgentOps] load run detail failed:', error));
        return () => { cancelled = true; };
    }, [activeRunId]);

    // async function control(action: string) {
    //     if (!activeRunMemo?._id) return;
    //     const result = await agentRunService.controlRun(activeRunMemo._id, action, controlNote);
    //     setRuns((items) => items.map((item) => item._id === result.run._id ? result.run : item));
    // }
    // async function review(action: string) {
    //     if (!activeRunMemo?._id) return;
    //     const result = await agentRunService.reviewRun(activeRunMemo._id, action, controlNote);
    //     setRuns((items) => items.map((item) => item._id === result.run._id ? result.run : item));
    // }
    async function control(action: string) {
        if (!activeRunMemo?._id || acting || !canControlRuns) return;
        setActing(true);
        try {
            const result = await agentRunService.controlRun(activeRunMemo._id, action, controlNote);
            setRuns((items) => items.map((item) => item._id === result.run._id ? result.run : item));
        } finally {
            setActing(false);
        }
    }

    async function review(action: string) {
        if (!activeRunMemo?._id || acting || !canReviewRuns) return;
        setActing(true);
        try {
            const result = await agentRunService.reviewRun(activeRunMemo._id, action, controlNote);
            setRuns((items) => items.map((item) => item._id === result.run._id ? result.run : item));
        } finally {
            setActing(false);
        }
    }
    async function runCommand(nextCommand = command) {
        if (!active || running || !nextCommand.trim()) return;
        setRunning(true); let draftRun: any = null;
        try {
            await start(active._id, { message: nextCommand, commandOptions: { agentId: selectedAgentId, skillId: selectedAgentId, scopes: selectedScopes, source: 'agentops-command-center' } }, {
                run_status: (payload) => {
                    const payloadRunId = payload.runDbId || payload.runId || 'running';
                    if (!draftRun) { draftRun = { _id: payloadRunId, runId: payload.runId || 'running', status: payload.status || 'running', prompt: nextCommand, intent: payload.intent, selectedSkill: payload.selectedSkill, plan: payload.plan, trace: [], logs: [] }; setRuns((items) => [draftRun, ...items.filter((item) => item._id !== 'running' && item._id !== payloadRunId)]); setActiveRunId(draftRun._id); }
                    else { draftRun = { ...draftRun, _id: payloadRunId, status: payload.status || draftRun.status, intent: payload.intent || draftRun.intent, selectedSkill: payload.selectedSkill || draftRun.selectedSkill, plan: payload.plan || draftRun.plan }; setRuns((items) => items.map((item) => item._id === draftRun._id ? draftRun : item)); }
                },
                trace: (payload) => { if (!draftRun) return; const nextTrace = [...(draftRun.trace || []).filter((item) => item.id !== payload.id), payload]; draftRun = { ...draftRun, trace: nextTrace }; setRuns((items) => items.map((item) => item._id === draftRun._id ? draftRun : item)); setActiveTraceId((current) => current || payload.id); },
                sources: (payload) => { if (!draftRun) return; draftRun = { ...draftRun, sources: payload.sources || [] }; setRuns((items) => items.map((item) => item._id === draftRun._id ? draftRun : item)); },
                artifacts: (payload) => { if (!draftRun) return; draftRun = { ...draftRun, artifacts: payload.artifacts || [] }; setRuns((items) => items.map((item) => item._id === draftRun._id ? draftRun : item)); },
                final: (payload: { run: any }) => {
                    setRuns((items) => [payload.run, ...items.filter((item) => item._id !== 'running' && item._id !== payload.run._id)]);
                    setActiveRunId(payload.run._id);
                    setActiveTraceId(payload.run.trace?.[0]?.id || '');
                    tenantSessionState.setSnapshot({ activeRunId: payload.run._id, runId: payload.run.runId });
                }
            });
        } finally { setRunning(false); await load(); }
    }
    async function rerunActive() {
        if (!activeRunMemo?._id || !canReplayRuns) return;
        const result = await agentRunService.replayRun(activeRunMemo._id, controlNote || 'AgentOps replay');
        setRuns((items) => [result.run, ...items]);
        setActiveRunId(result.run._id);
        setActiveTraceId(result.run.trace?.[0]?.id || '');
        tenantSessionState.setSnapshot({ activeRunId: result.run._id, runId: result.run.runId });
    }
    function toggleScope(scopeId: string) { setSelectedScopes((items) => items.includes(scopeId) ? items.filter((item) => item !== scopeId) : [...items, scopeId]); }

    return (
        <div className="ops-console-page">
            <div className="product-page-kicker">AgentOps Runtime Console</div>
            <Header title="AgentOps 控制台" desc="面向运行治理：Run Registry、状态机、Trace Timeline、Tool Call Audit、Run Detail、审批记录和失败回放。" />
            <nav className="ops-console-tabs" aria-label="AgentOps 功能">
                <button type="button" className={consoleView === 'runs' ? 'active' : ''} onClick={() => setConsoleView('runs')}>运行治理</button>
                {canManageRuntimeModels ? <button type="button" className={consoleView === 'models' ? 'active' : ''} onClick={() => setConsoleView('models')}>模型设置</button> : null}
            </nav>
            {isDemoViewer ? (
                <div className="ops-access-notice" role="status">
                    <strong>受限演示模式</strong>
                    <span>可创建限额 Demo Run，并查看当前租户的 Run、RAG、Trace、Artifact 和审计记录；不可暂停、恢复、回滚、重放或审批。</span>
                </div>
            ) : null}
            {consoleView === 'models' && canManageRuntimeModels ? (
                <ModelSettingsPanel onRuntimeChanged={() => { void load(); }} />
            ) : (
            <>
            <RuntimeSummary activeRun={activeRunMemo} blueprint={blueprint} ragRuntime={ragRuntime} ragLive={ragLive} />
            <CommandCenter command={command} selectedAgentId={selectedAgentId} selectedAgent={selectedAgent} capabilities={blueprint?.capabilities || []} selectedScopes={selectedScopes} selectedScopeLabels={selectedScopeLabels} running={running} sessionReady={Boolean(active)} activeRun={activeRunMemo} readOnlyControls={!canControlRuns || !canReplayRuns} onCommandChange={setCommand} onAgentChange={setSelectedAgentId} onToggleScope={toggleScope} onRun={() => runCommand()} onRefresh={load} onControl={control} onRerun={rerunActive} />
            <MetricsGrid metrics={metrics} />
            <RuntimeMetrics metrics={metrics} traceCount={trace.length} metricTrends={metricTrends} blueprint={blueprint} selectedAgent={selectedAgent} selectedScopeLabels={selectedScopeLabels} retrievalView={retrievalView} ragRuntime={ragRuntime} ragLive={ragLive} onOpenDetail={() => { setActiveTraceId(trace[0]?.id || ''); setDetailTab('overview'); setDetailOpen(true); }} />
            <main className="ops-console-layout">
                <RunRegistry runs={filteredRuns} activeRun={activeRunMemo} keyword={keyword} filter={filter} onKeywordChange={setKeyword} onFilterChange={setFilter} onSelectRun={(run) => { setActiveRunId(run._id); setActiveTraceId(run.trace?.[0]?.id || ''); tenantSessionState.setSnapshot({ activeRunId: run._id, runId: run.runId }); }} />
                <section className="ops-main-stage">
                    <StateMachinePanel stateSteps={stateSteps} activeTrace={activeTrace} trendPath={trendPath} onSelectTrace={setActiveTraceId} />
                    <TraceAuditPanel trace={trace} activeTrace={activeTrace} onSelectTrace={setActiveTraceId} />
                </section>
                {/* <RunDetailDock activeRun={activeRunMemo} controlNote={controlNote} onControlNoteChange={setControlNote} onReview={review} /> */}
                <RunDetailDock activeRun={activeRunMemo} controlNote={controlNote} onControlNoteChange={setControlNote} onReview={review} disabled={acting} readOnly={!canReviewRuns} />
            </main>
            <RunDetailDrawer open={detailOpen} activeRun={activeRunMemo} blueprint={blueprint} detailTab={detailTab} onTabChange={setDetailTab} onClose={() => setDetailOpen(false)} />
            </>
            )}
        </div>
    );
}
