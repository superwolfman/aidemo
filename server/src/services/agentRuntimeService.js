import crypto from 'node:crypto';

export const runStateTransitions = {
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

export function now() {
  return new Date().toISOString();
}

export function tokenCount(text) {
  return Math.max(10, Math.ceil(String(text || '').length / 1.8));
}

export function step(id, name, status, extra = {}) {
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

export function auditLog(level, message, extra = {}) {
  return {
    id: `log-${crypto.randomUUID()}`,
    level,
    message,
    at: now(),
    ...extra
  };
}

export function canTransition(from, to) {
  if (from === to) return true;
  return (runStateTransitions[from] || []).includes(to);
}

export function createStateTransition({ from, to, label, actorId, reason = '', meta = {} }) {
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

export function transitionRunPatch(run, to, { label, actorId, reason = '', meta = {} } = {}) {
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
