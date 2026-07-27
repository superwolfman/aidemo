import { now } from './agentRuntimeService.js';

export function normalizeSourceRef (source, index) {
    return {
        id: source._id || source.id || `source-${index + 1}`,
        index: index + 1,
        title: source.documentTitle || source.title || 'Untitled source',
        score: Number(source.score || 0),
        rerankScore: Number(source.rerankScore ?? source.score ?? 0),
        rerankStrategy: source.rerankStrategy,
        filterReason: source.filterReason,
        retrievalBackend: source.retrievalBackend,
        sourcePath: source.sourcePath
    };
}

export function attachArtifactWorkflow (artifacts, traceStepId = 'tool', sources = [], evalId) {
    const sourceRefs = sources.map(normalizeSourceRef);
    return artifacts.map((artifact) => ({
        ...artifact,
        status: artifact.status || 'draft',
        evalId: evalId || artifact.evalId || undefined,
        version: 1,
        traceStepId,
        generatedBy: {
            tool: 'planDelivery',
            traceStepId,
            generatedAt: now()
        },
        sourceRefs,
        sourceIds: sourceRefs.map((source) => source.id),
        reviewStatus: 'pending',
        versions: [
            {
                version: 1,
                status: 'created',
                content: artifact.content,
                createdAt: now()
            }
        ],
        approvals: [],
        exports: []
    }));
}

export function applyArtifactReview (artifact, { action = 'confirm', note = '', operatorId = '' } = {}) {
    const statusMap = {
        confirm: 'confirmed',
        review: 'reviewed',
        revise: 'revision_requested',
        reject: 'rejected'
    };
    const nextStatus = statusMap[action] || 'reviewed';
    const approval = {
        id: `approval-${artifact.id}-${Date.now()}`,
        action,
        status: nextStatus,
        note,
        operatorId,
        createdAt: now()
    };

    return {
        ...artifact,
        status: nextStatus,
        reviewStatus: nextStatus,
        updatedAt: approval.createdAt,
        approvals: [
            approval,
            ...(artifact.approvals || [])
        ].slice(0, 20)
    };
}
