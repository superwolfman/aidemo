import { request } from '../api/client';

export interface AgentSessionRef { _id: string; title: string; activeAgentId?: string; messages?: any[]; activeSkillId?: string }

export async function listAgentStudioSessions(): Promise<{ sessions: AgentSessionRef[] }> {
    return request('/api/agent-studio/sessions');
}

export async function createAgentStudioSession(title: string): Promise<{ session: AgentSessionRef }> {
    return request('/api/agent-studio/sessions', {
        method: 'POST',
        body: JSON.stringify({ title })
    });
}

export async function listCopilotSessions(): Promise<{ sessions: AgentSessionRef[] }> {
    return request('/api/copilot/sessions');
}

export async function createCopilotSession(title: string, skillId: string): Promise<{ session: AgentSessionRef }> {
    return request('/api/copilot/sessions', {
        method: 'POST',
        body: JSON.stringify({ title, skillId })
    });
}

export async function getCopilotSession(sessionId: string): Promise<{ session: AgentSessionRef }> {
    return request(`/api/copilot/sessions/${sessionId}`);
}