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

let blueprintGeneration = 0;
let blueprintRequest: { generation: number; promise: Promise<RuntimeBlueprint> } | null = null;

export function invalidateAgentStudioBlueprint() {
    blueprintGeneration += 1;
    blueprintRequest = null;
}

export async function getAgentStudioBlueprint(): Promise<RuntimeBlueprint> {
    if (blueprintRequest?.generation === blueprintGeneration) return blueprintRequest.promise;
    const generation = blueprintGeneration;
    const promise = request('/api/agent-studio/blueprint') as Promise<RuntimeBlueprint>;
    blueprintRequest = { generation, promise };
    try {
        return await promise;
    } finally {
        // Keep only in-flight deduplication. A later user refresh still reaches the server truth.
        if (blueprintRequest?.generation === generation && blueprintRequest.promise === promise) {
            blueprintRequest = null;
        }
    }
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
