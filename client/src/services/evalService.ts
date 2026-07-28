import { request } from '../api/client';

export interface EvalCase {
    id: string;
    title: string;
    prompt: string;
    expected: string[];
    status?: string;
    lastResult?: any;
    modeId?: string;
    form?: Record<string, string>;
}

export async function listAgentStudioEvalCases(): Promise<{ cases: EvalCase[] }> {
    return request('/api/agent-studio/eval-cases');
}

export async function scoreAgentStudioEvalCase(evalCaseId: string, runId: string): Promise<{ run: any }> {
    return request(`/api/agent-studio/eval-cases/${evalCaseId}/score`, {
        method: 'POST',
        body: JSON.stringify({ runId })
    });
}

export async function listCopilotEvalCases(): Promise<{ cases: EvalCase[] }> {
    return request('/api/copilot/eval-cases');
}