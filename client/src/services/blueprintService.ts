import { request } from '../api/client';

export interface RuntimeBlueprint {
    capabilities: Array<{ id: string; name: string; description: string; intents: string[]; tools: string[] }>;
    architecture: { frontend: string[]; bff: string[]; states: string[]; data: string[] };
    controls?: { supportedActions: string[]; policy: string };
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
            embeddingProvider?: string;
            storeKind?: string;
            connected?: boolean;
            vectorSearchReady?: boolean;
        };
    };
}

export async function getAgentStudioBlueprint(): Promise<RuntimeBlueprint> {
    return request('/api/agent-studio/blueprint');
}

export interface CopilotRuntime {
    llm: { provider: string; mode: string; model: string; configured: boolean; streaming?: boolean; protocol?: string };
    rag: {
        backend: string;
        mode?: string;
        vectorStore: string;
        retrievalBackend?: string;
        productionReady: boolean;
        index?: string;
        vectorPath?: string;
        dimensions?: number;
        connection?: string;
        embeddingProvider?: string;
        storeKind?: string;
        connected?: boolean;
        vectorSearchReady?: boolean;
        error?: string;
    };
    mcp: { enabled: boolean; transport: string; command: string };
}

export async function getCopilotRuntime(): Promise<CopilotRuntime> {
    return request('/api/copilot/runtime');
}