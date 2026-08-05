import { request, streamRequest } from '../api/client';

export async function createSession(skillId: string, title: string) {
    return request('/api/agent-studio/sessions', {
        method: 'POST',
        body: JSON.stringify({ skillId, title })
    });
}

export function streamAgentStudioRun(
    sessionId: string,
    body: Record<string, unknown>,
    handlers: Record<string, (data: any) => void> = {},
    signal?: AbortSignal
) {
    return streamRequest(
        `/api/agent-studio/sessions/${sessionId}/runs/stream`,
        body,
        handlers,
        signal
    );
}

export async function listAgentStudioRuns(): Promise<{ runs: any[] }> {
    return request('/api/agent-studio/runs');
}

export async function getAgentStudioRun(runId: string): Promise<{ run: any }> {
    return request(`/api/agent-studio/runs/${runId}`);
}

export const listRuns = listAgentStudioRuns;

export async function controlRun(runId: string, action: string, reason = '') {
    return request(`/api/agent-studio/runs/${runId}/control`, {
        method: 'POST',
        body: JSON.stringify({ action, reason })
    });
}

export async function reviewRun(runId: string, action: string, note = '') {
    return request(`/api/agent-studio/runs/${runId}/review`, {
        method: 'POST',
        body: JSON.stringify({ action, note })
    });
}

export async function replayRun(runId: string, reason = '') {
    return request(`/api/agent-studio/runs/${runId}/replay`, {
        method: 'POST',
        body: JSON.stringify({ reason })
    });
}