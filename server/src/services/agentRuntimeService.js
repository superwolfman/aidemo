import crypto from 'node:crypto';

export const runStateTransitions = {
    none: ['created'],
    created: ['intent_detected', 'failed', 'cancelled', 'paused'],
    intent_detected: ['skill_selected', 'failed', 'cancelled', 'paused'],
    skill_selected: ['retrieving', 'failed', 'cancelled', 'paused'],
    retrieving: ['tool_running', 'failed', 'cancelled', 'paused'],
    tool_running: ['streaming', 'failed', 'cancelled', 'paused'],
    streaming: ['review_required', 'failed', 'cancelled', 'paused'],
    review_required: ['confirmed', 'rejected', 'revision_requested', 'paused'],
    revision_requested: ['tool_running', 'cancelled', 'paused'],
    paused: ['resumed', 'cancelled', 'rolled_back'],
    resumed: ['review_required', 'tool_running', 'streaming', 'failed', 'paused', 'confirmed', 'rejected', 'revision_requested'],
    rolled_back: ['revision_requested', 'cancelled'],
    failed: ['resumed', 'rolled_back', 'cancelled'],
    confirmed: [],
    rejected: [],
    cancelled: []
};

export function now () {
    return new Date().toISOString();
}

export function tokenCount (text) {
    return Math.max(10, Math.ceil(String(text || '').length / 1.8));
}

export function step (id, name, status, extra = {}) {
    return {
        id,
        name,
        status,
        durationMs: 70 + Math.floor(Math.random() * 160),
        tokenUsage: extra.tokenUsage || 0,
        at: now(),
        ...extra
    };
}

export function auditLog (level, message, extra = {}) {
    return {
        id: `log-${crypto.randomUUID()}`,
        level,
        message,
        at: now(),
        ...extra
    };
}

export function canTransition (from, to) {
    if (from === to) return true;
    return (runStateTransitions[from] || []).includes(to);
}

export function createStateTransition ({ from, to, label, actorId, reason = '', meta = {} }) {
    return {
        id: `transition-${crypto.randomUUID()}`,
        from,
        to,
        label,
        actorId,
        reason,
        at: now(),
        meta
    };
}

export function transitionRunPatch (run, to, { label, actorId, reason = '', meta = {} } = {}) {
    const from = run.status || 'created';
    if (!canTransition(from, to)) {
        const error = new Error(`Invalid Agent Run transition: ${from} -> ${to}`);
        error.statusCode = 409;
        throw error;
    }
    const transition = createStateTransition({ from, to, label: label || to, actorId, reason, meta });
    return {
        status: to,
        stateTransitions: [...(run.stateTransitions || []), transition]
    };
}

export async function applyTransition (store, run, to, { label, actorId, reason = '', meta = {} } = {}) {
    const from = run.status || 'created';
    if (!canTransition(from, to)) {
        const error = new Error(`Invalid Agent Run transition: ${from} -> ${to}`);
        error.statusCode = 409;
        throw error;
    }
    const transition = createStateTransition({ from, to, label: label || to, actorId, reason, meta });
    const updated = await store.updateRecord('agent_runs', run._id || run.runId, {
        status: to,
        stateTransitions: [...(run.stateTransitions || []), transition]
    });
    return updated;
}

export function getControlTargetStatus (action) {
    const statusMap = {
        pause: 'paused',
        resume: 'resumed',
        rollback: 'rolled_back',
        cancel: 'cancelled'
    };
    return statusMap[action] || 'paused';
}

export function buildRollbackArtifacts (run, actorId) {
    return (run.artifacts || []).map((artifact) => {
        const previousVersion = (artifact.versions || [])[1] || (artifact.versions || [])[0];
        if (!previousVersion) return artifact;
        const version = Number(artifact.version || 1) + 1;
        return {
            ...artifact,
            content: previousVersion.content,
            status: 'rolled_back',
            reviewStatus: 'pending',
            version,
            versions: [
                {
                    version,
                    status: 'rolled_back',
                    content: previousVersion.content,
                    createdAt: now(),
                    operatorId: actorId,
                    rollbackFrom: artifact.version
                },
                ...(artifact.versions || [])
            ].slice(0, 12)
        };
    });
}

export function buildRunControlPatch (run, { action = 'pause', actorId, reason = '' } = {}) {
    const status = getControlTargetStatus(action);
    const transitionPatch = transitionRunPatch(run, status, {
        label: `运行控制：${action}`,
        actorId,
        reason
    });
    const artifacts = action === 'rollback' ? buildRollbackArtifacts(run, actorId) : run.artifacts || [];
    const controlRecord = {
        id: `control-${crypto.randomUUID()}`,
        action,
        status,
        reason,
        operatorId: actorId,
        createdAt: now()
    };
    const log = auditLog('control', `运行控制动作：${action}`, {
        action,
        operatorId: actorId,
        reason
    });

    return {
        action,
        status,
        artifacts,
        log,
        patch: {
            ...transitionPatch,
            controlState: {
                action,
                status,
                reason,
                updatedAt: now(),
                operatorId: actorId,
                previousStatus: run.status
            },
            controlHistory: [
                controlRecord,
                ...(run.controlHistory || [])
            ]
        }
    };
}

export function createReplayRunDraft (run, { actorId, reason = '' } = {}) {
    const createdAt = now();
    const {
        _id,
        id,
        runId,
        createdAt: previousCreatedAt,
        updatedAt: previousUpdatedAt,
        logs,
        stateTransitions,
        reviewHistory,
        controlHistory,
        replayHistory,
        quality,
        ...runDraft
    } = run;
    const sourceRunId = _id || runId;
    return {
        ...runDraft,
        runId: `run-${crypto.randomUUID()}`,
        status: 'created',
        createdAt,
        updatedAt: createdAt,
        replayOf: sourceRunId,
        replayReason: reason,
        replayBy: actorId,
        trace: [],
        logs: [
            auditLog('replay', '创建失败回放 Run', {
                sourceRunId,
                actorId,
                reason
            })
        ],
        stateTransitions: [
            createStateTransition({
                from: run.status || 'failed',
                to: 'created',
                label: '失败回放',
                actorId,
                reason,
                meta: { sourceRunId }
            })
        ],
        reviewHistory: [],
        controlHistory: [],
        quality: null
    };
}

export function buildRunSummary (run = {}) {
    return {
        id: run._id || run.runId,
        intent: run.intent?.label || run.skill || 'unknown',
        status: run.status || 'created',
        transitions: (run.stateTransitions || []).length,
        artifacts: (run.artifacts || []).length,
        approvals: (run.reviewHistory || []).length,
        tokens: run.tokenCount || 0,
        durationMs: run.durationMs || 0,
        sources: (run.sources || []).length,
        updatedAt: run.updatedAt || null
    };
}