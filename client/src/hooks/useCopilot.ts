import { useCallback, useState } from 'react';
import * as copilotService from '../services/copilotService';
import * as sessionService from '../services/sessionService';
import * as ragService from '../services/ragService';
import * as approvalService from '../services/approvalService';

export function useCopilot() {
    const [skills, setSkills] = useState<any[]>([]);
    const [sessions, setSessions] = useState<any[]>([]);
    const [active, setActive] = useState<any>(null);
    const [models, setModels] = useState<any[]>([]);
    const [selectedModelId, setSelectedModelId] = useState('');
    const [runtime, setRuntime] = useState<any>(null);
    const [documents, setDocuments] = useState<any[]>([]);
    const [knowledgeStats, setKnowledgeStats] = useState<any>(null);
    const [templates, setTemplates] = useState<any[]>([]);
    const [evalCases, setEvalCases] = useState<any[]>([]);
    const [vectorHealth, setVectorHealth] = useState<any>(null);
    const [ragDiagnostics, setRagDiagnostics] = useState<any>(null);
    const [approval, setApproval] = useState<any>(null);
    const [approvalHistory, setApprovalHistory] = useState<any[]>([]);
    const [artifacts, setArtifacts] = useState<any[]>([]);
    const [trace, setTrace] = useState<any[]>([]);
    const [sources, setSources] = useState<any[]>([]);
    const [runState, setRunState] = useState<any>({ status: 'idle', label: '等待输入' });
    const [ragPreview, setRagPreview] = useState<any[]>([]);
    const [ragQuery, setRagQuery] = useState('');
    const [projectSyncing, setProjectSyncing] = useState(false);
    const [checkingVectorStore, setCheckingVectorStore] = useState(false);
    const [ragSearching, setRagSearching] = useState(false);

    const loadSkills = useCallback(async () => {
        const result = await copilotService.listSkills();
        setSkills(result.skills);
    }, []);
    const loadModels = useCallback(async () => {
        const result = await copilotService.listModels();
        setModels(result.models || []);
        setSelectedModelId((current: string) => current || result.models?.find((m: any) => m.active || m.configured)?.id || result.models?.[0]?.id || '');
    }, []);
    const loadRuntime = useCallback(async () => {
        const result = await copilotService.getCopilotRuntime();
        setRuntime(result);
        setRagDiagnostics((current: any) => current || { rag: result.rag, query: '', scopes: [], sources: [], source: 'runtime' });
    }, []);
    const loadKnowledge = useCallback(async () => {
        const result = await ragService.listKnowledge();
        setDocuments(result.documents);
        setKnowledgeStats(result.stats || null);
    }, []);
    const loadTemplates = useCallback(async () => {
        const result = await ragService.listTemplates();
        setTemplates(result.templates || []);
    }, []);
    const loadEvalCases = useCallback(async () => {
        const result = await (await import('../services/evalService')).listCopilotEvalCases();
        setEvalCases(result.cases || []);
    }, []);

    const createSession = useCallback(async (title: string, skillId: string) => {
        const created = await sessionService.createCopilotSession(title, skillId);
        setSessions((items) => [created.session, ...items]);
        setActive(created.session);
        return created.session;
    }, []);

    const refreshActive = useCallback(async (sessionId: string) => {
        const result = await sessionService.getCopilotSession(sessionId);
        setActive(result.session);
        setSessions((items) => items.map((item) => item._id === sessionId ? result.session : item));
    }, []);

    const uploadKnowledge = useCallback(async (payload: { filename: string; mimeType: string; content: string; scopes: string[] }) => {
        const result = await ragService.uploadKnowledge(payload);
        setDocuments((items) => [result.document, ...items]);
        setKnowledgeStats((stats: any) => stats ? { ...stats, uploads: stats.uploads + 1, chunks: stats.chunks + (result.document.chunkCount || 0) } : stats);
    }, []);

    const importTemplate = useCallback(async (templateId: string) => {
        const result = await ragService.importTemplate(templateId);
        setDocuments((items) => [result.document, ...items.filter((item: any) => item.title !== result.document.title)]);
        setKnowledgeStats((stats: any) => stats ? { ...stats, templates: stats.templates + 1, chunks: stats.chunks + (result.document.chunkCount || 0) } : stats);
        setRagQuery(result.document.title);
    }, []);

    const syncProject = useCallback(async () => {
        setProjectSyncing(true);
        try {
            await ragService.syncProjectKnowledge();
            const knowledgeResult = await ragService.listKnowledge();
            setDocuments(knowledgeResult.documents);
            setKnowledgeStats(knowledgeResult.stats || null);
            setRagQuery('AI Architecture Copilot RAG Agent Trace DeepSeek MongoDB Vector Search');
            setRagDiagnostics((current: any) => current ? { ...current, source: 'runtime' } : current);
        } finally { setProjectSyncing(false); }
    }, []);

    const checkVectorStore = useCallback(async () => {
        setCheckingVectorStore(true);
        try {
            const result = await ragService.checkHealth();
            setVectorHealth(result);
            setRuntime((current: any) => current ? { ...current, rag: result.status } : current);
        } finally { setCheckingVectorStore(false); }
    }, []);

    const searchPreview = useCallback(async (query: string, scopes: string[]) => {
        setRagSearching(true);
        try {
            const result = await ragService.search(query, scopes, 4);
            const nextSources = result.sources || [];
            setRagPreview(nextSources);
            setRagDiagnostics({
                rag: result.rag || runtime?.rag,
                query: result.query || query,
                scopes: result.scopes || scopes,
                latencyMs: result.latencyMs,
                sources: nextSources,
                source: 'preview'
            });
        } finally { setRagSearching(false); }
    }, [runtime]);

    const review = useCallback(async (approvalId: string, action: 'confirm' | 'revise' | 'reject', revision: string, note: string) => {
        const result = await approvalService.reviewApproval(approvalId, action, revision, note);
        setApproval(result.approval);
        setApprovalHistory((items) => [result.approval, ...items.filter((item: any) => item._id !== result.approval._id)].slice(0, 5));
        setTrace((items) => items.map((item: any) => item.id === 'human' ? { ...item, status: action === 'reject' ? 'failed' : 'success', output: { action } } : item));
    }, []);

    const resetRunView = useCallback((rt: any) => {
        setTrace([]);
        setRunState({ status: 'idle', label: '等待输入' });
        setArtifacts([]);
        setApproval(null);
        setRagPreview([]);
        setRagDiagnostics(rt ? { rag: rt.rag, query: '', scopes: [], sources: [], source: 'runtime' } : null);
    }, []);

    return {
        skills, setSkills, loadSkills,
        sessions, setSessions, active, setActive, createSession, refreshActive,
        models, setModels, selectedModelId, setSelectedModelId, loadModels,
        runtime, setRuntime, loadRuntime,
        documents, setDocuments, knowledgeStats, setKnowledgeStats, loadKnowledge,
        templates, setTemplates, loadTemplates,
        evalCases, setEvalCases, loadEvalCases,
        vectorHealth, setVectorHealth, checkVectorStore, checkingVectorStore, setCheckingVectorStore,
        ragDiagnostics, setRagDiagnostics,
        approval, setApproval, approvalHistory, setApprovalHistory,
        artifacts, setArtifacts,
        trace, setTrace,
        sources, setSources,
        runState, setRunState,
        ragPreview, setRagPreview,
        ragQuery, setRagQuery,
        projectSyncing, setProjectSyncing, syncProject,
        ragSearching, setRagSearching, searchPreview,
        review, resetRunView
    };
}