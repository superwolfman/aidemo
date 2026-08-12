import crypto from 'node:crypto';
import { now, auditLog } from './agentRuntimeService.js';

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
    // “确认”是幂等业务动作。客户端重试、双击或网关重放不能制造重复审批记录。
    if (action === 'confirm' && artifact.status === nextStatus && artifact.reviewStatus === nextStatus) {
        return artifact;
    }
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

export async function exportArtifact (store, runId, artifactId, { format = 'markdown', actorId, context } = {}) {
    const run = await store.getRecord('agent_runs', runId, context);
    const artifact = run?.artifacts?.find((item) => item.id === artifactId);
    if (!artifact) {
        const err = new Error('Artifact not found');
        err.statusCode = 404;
        throw err;
    }
    const fmt = format === 'json' ? 'json' : 'markdown';
    const content = typeof artifact.content === 'string' ? artifact.content : JSON.stringify(artifact.content, null, 2);
    const exportRecord = {
        id: `export-${crypto.randomUUID()}`,
        format: fmt,
        filename: `${artifact.type}-${artifact.id}.${fmt === 'json' ? 'json' : 'md'}`,
        exportedAt: now(),
        exportedBy: actorId
    };
    const artifacts = (run.artifacts || []).map((item) =>
        item.id === artifact.id
            ? { ...item, exports: [exportRecord, ...(item.exports || [])].slice(0, 20) }
            : item
    );
    const log = auditLog('artifact', `Artifact 导出：${artifact.title}`, { artifactId, format: fmt });
    const nextRun = await store.updateRecord('agent_runs', run._id, {
        artifacts,
        logs: [...(run.logs || []), log]
    }, context);
    return {
        filename: exportRecord.filename,
        format: fmt,
        run: nextRun,
        content: fmt === 'json'
            ? JSON.stringify(artifact, null, 2)
            : `# ${artifact.title}\n\n> version: ${artifact.version || 1} / status: ${artifact.status || 'draft'}\n\n${content}`
    };
}
