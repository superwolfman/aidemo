import { request } from '../api/client';

export interface VectorStoreHealth {
    ok: boolean;
    live: boolean;
    message: string;
    status: any;
    checks: Record<string, any>;
}

export interface RagSource {
    _id: string;
    documentTitle: string;
    content: string;
    score: number;
    tags?: string[];
    chunkIndex?: number;
    retrievalBackend?: string;
    sourceType?: string;
    sourcePath?: string;
}

export async function checkHealth(): Promise<VectorStoreHealth> {
    return request('/api/copilot/vector-store/health');
}

export async function search(query: string, scopes?: string[], limit = 4): Promise<{ sources: RagSource[]; rag?: any; query?: string; scopes?: string[]; latencyMs?: number }> {
    return request('/api/copilot/knowledge/search', {
        method: 'POST',
        body: JSON.stringify({ query, scopes, limit })
    });
}

export async function uploadKnowledge(payload: { filename: string; mimeType: string; content: string; scopes: string[] }) {
    return request('/api/copilot/knowledge/upload', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function importTemplate(templateId: string) {
    return request(`/api/copilot/knowledge/templates/${templateId}/import`, {
        method: 'POST',
        body: JSON.stringify({})
    });
}

export async function syncProjectKnowledge() {
    return request('/api/copilot/knowledge/project/import', {
        method: 'POST',
        body: JSON.stringify({})
    });
}

export async function listKnowledge(): Promise<{ documents: any[]; stats: any }> {
    return request('/api/copilot/knowledge');
}

export async function listTemplates(): Promise<{ templates: any[] }> {
    return request('/api/copilot/knowledge/templates');
}