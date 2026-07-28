import { request, streamRequest } from '../api/client';
export { getCopilotRuntime } from './blueprintService';

export interface Skill {
    id: string;
    name: string;
    version: string;
    description: string;
    systemPrompt: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    allowedTools: string[];
    knowledgeScopes: string[];
}

export interface ModelPreset {
    id: string;
    label: string;
    provider: string;
    model: string;
    description: string;
    configured: boolean;
    active?: boolean;
}

export async function listSkills(): Promise<{ skills: Skill[] }> {
    return request('/api/copilot/skills');
}

export async function listModels(): Promise<{ models: ModelPreset[] }> {
    return request('/api/copilot/models');
}

export function streamCopilotMessage(
    sessionId: string,
    body: Record<string, unknown>,
    handlers: Record<string, (data: any) => void> = {},
    signal?: AbortSignal
) {
    return streamRequest(
        `/api/copilot/sessions/${sessionId}/messages/stream`,
        body,
        handlers,
        signal
    );
}