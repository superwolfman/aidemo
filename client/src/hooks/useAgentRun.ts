import { useCallback, useRef, useState } from 'react';
import * as agentRunService from '../services/agentRunService';

export function useAgentRun(_kind: 'agent-studio' | 'delivery' = 'agent-studio') {
    const [status, setStatus] = useState('idle');
    const [runState, setRunState] = useState<any>({ status: 'idle', label: '等待运行' });
    const [answer, setAnswer] = useState('');
    const [trace, setTrace] = useState<any[]>([]);
    const [sources, setSources] = useState<any[]>([]);
    const [externalSources, setExternalSources] = useState<any[]>([]);
    const [externalStatus, setExternalStatus] = useState<any>(null);
    const [filteredChunks, setFilteredChunks] = useState<any[]>([]);
    const [ragDiagnostics, setRagDiagnostics] = useState<any>(null);
    const [artifacts, setArtifacts] = useState<any[]>([]);
    const [plan, setPlan] = useState<any[]>([]);
    const [logs, setLogs] = useState<any[]>([]);
    const [activeRun, setActiveRun] = useState<any>(null);
    const [quality, setQuality] = useState<any>(null);
    const abortRef = useRef<AbortController | null>(null);
    const [running, setRunning] = useState(false);

    const start = useCallback(async (
        sessionId: string,
        body: Record<string, unknown>,
        handlers: Record<string, (payload: any) => void> = {},
        signal?: AbortSignal
    ) => {
        setRunning(true);
        setAnswer('');
        setTrace([]);
        setSources([]);
        setExternalSources([]);
        setExternalStatus(null);
        setFilteredChunks([]);
        setRagDiagnostics(null);
        setArtifacts([]);
        setPlan([]);
        setLogs([]);
        setActiveRun(null);
        setRunState({ status: 'intent_detected', label: '意图识别中' });

        const mergedHandlers = {
            run_status: (payload: any) => {
                handlers.run_status?.(payload);
                if (!handlers.run_status) setRunState(payload);
            },
            plan: (payload: any) => {
                handlers.plan?.(payload);
                if (!handlers.plan) {
                    setPlan(payload.plan || []);
                    setRunState((current: any) => ({
                        ...current,
                        intent: payload.intent,
                        selectedSkill: payload.selectedSkill,
                        plan: payload.plan
                    }));
                }
            },
            trace: (payload: any) => {
                handlers.trace?.(payload);
                if (!handlers.trace) setTrace((items) =>
                    [...items.filter((item) => item.id !== payload.id), payload]
                );
            },
            sources: (payload: any) => {
                handlers.sources?.(payload);
                // 外部证据状态始终由 useAgentRun 接管，不受调用方自定义 sources 处理器影响，
                // 否则传了自定义 handler 的页面（如 DeliveryCopilot / AgentStudio / CopilotWorkbench）
                // 会跳过外部状态的设置，导致 RAG 面板永不显示外部检索区域。
                setExternalSources(payload.externalSources || []);
                setExternalStatus(payload.externalStatus || null);
                if (!handlers.sources) {
                    setSources(payload.sources || []);
                    setFilteredChunks(payload.filteredChunks || []);
                    setRagDiagnostics(payload.diagnostics || null);
                }
            },
            artifacts: (payload: any) => {
                handlers.artifacts?.(payload);
                if (!handlers.artifacts) setArtifacts(payload.artifacts || []);
            },
            delta: (payload: any) => {
                handlers.delta?.(payload);
                if (!handlers.delta) setAnswer((current) => current + payload.text);
            },
            final: (payload: any) => {
                handlers.final?.(payload);
            },
            error: (payload: any) => {
                handlers.error?.(payload);
                if (!handlers.error) {
                    setStatus('failed');
                    setRunState({
                        status: 'failed',
                        label: 'Agent Run 执行失败',
                        error: payload
                    });
                }
            }
        };

        try {
            await agentRunService.streamAgentStudioRun(sessionId, body, mergedHandlers, signal);
        } finally {
            setRunning(false);
        }
    }, []);

    const control = useCallback((runId: string, action: string, reason?: string) =>
        agentRunService.controlRun(runId, action, reason), []);

    const review = useCallback((runId: string, action: string, note?: string) =>
        agentRunService.reviewRun(runId, action, note), []);

    const replay = useCallback((runId: string, reason?: string) =>
        agentRunService.replayRun(runId, reason), []);

    const stop = useCallback(() => {
        abortRef.current?.abort();
        setRunning(false);
        setRunState({ status: 'cancelled', label: '用户已停止' });
    }, []);

    return {
        status, setStatus, runState, setRunState, answer, setAnswer, trace, setTrace,
        sources, setSources, externalSources, setExternalSources, externalStatus, setExternalStatus,
        filteredChunks, setFilteredChunks, ragDiagnostics, setRagDiagnostics,
        artifacts, setArtifacts, plan, setPlan, logs, setLogs,
        activeRun, setActiveRun, quality, setQuality, running, setRunning,
        abortRef, start, control, review, replay, stop
    };
}
