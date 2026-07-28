import { request } from '../api/client';

export async function updateArtifact(runId: string, artifactId: string, patch: Record<string, unknown>) {
    return request(`/api/agent-studio/runs/${runId}/artifacts/${artifactId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch)
    });
}

export async function confirmArtifact(runId: string, artifactId: string, note = '') {
    return request(`/api/agent-studio/runs/${runId}/artifacts/${artifactId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ note })
    });
}

export async function reviewArtifact(runId: string, artifactId: string, note = '') {
    return request(`/api/agent-studio/runs/${runId}/artifacts/${artifactId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ action: 'review', note })
    });
}

export async function exportArtifact(runId: string, artifactId: string, format: 'markdown' | 'json') {
    return request(`/api/agent-studio/runs/${runId}/artifacts/${artifactId}/export?format=${format}`);
}