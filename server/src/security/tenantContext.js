const TENANT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const SCOPE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export const DEFAULT_TENANT_ID = 'tenant-demo';

export class AuthorizationError extends Error {
    constructor (message, code = 'FORBIDDEN') {
        super(message);
        this.name = 'AuthorizationError';
        this.code = code;
        this.statusCode = 403;
    }
}

export function normalizeKnowledgeScopes (scopes) {
    if (!Array.isArray(scopes)) return [];
    return [...new Set(scopes
        .map((scope) => String(scope || '').trim())
        .filter((scope) => SCOPE_PATTERN.test(scope)))];
}

export function createTenantContext (user) {
    const tenantId = String(user?.tenantId || '').trim();
    if (!TENANT_ID_PATTERN.test(tenantId)) {
        throw new AuthorizationError('Authenticated user has no valid tenant assignment', 'TENANT_CONTEXT_MISSING');
    }

    const actorId = String(user?._id || '').trim();
    if (!actorId) {
        throw new AuthorizationError('Authenticated user has no valid actor id', 'ACTOR_CONTEXT_MISSING');
    }

    const allowedKnowledgeScopes = Array.isArray(user.allowedKnowledgeScopes)
        ? [...new Set(user.allowedKnowledgeScopes.map(String))]
        : [];

    return Object.freeze({
        tenantId,
        actorId,
        role: String(user.role || 'member'),
        allowedKnowledgeScopes: Object.freeze(allowedKnowledgeScopes)
    });
}

export function createServiceTenantContext ({ tenantId, actorId = 'system', allowedKnowledgeScopes = ['*'] }) {
    return createTenantContext({
        _id: actorId,
        tenantId,
        role: 'service',
        allowedKnowledgeScopes
    });
}

export function requireTenantContext (context) {
    if (!context || !TENANT_ID_PATTERN.test(String(context.tenantId || ''))) {
        throw new AuthorizationError('Tenant context is required', 'TENANT_CONTEXT_REQUIRED');
    }
    if (!String(context.actorId || '').trim()) {
        throw new AuthorizationError('Actor context is required', 'ACTOR_CONTEXT_REQUIRED');
    }
    return context;
}

export function authorizeKnowledgeScopes (context, requestedScopes) {
    requireTenantContext(context);
    const normalized = normalizeKnowledgeScopes(requestedScopes);
    if (!normalized.length) {
        throw new AuthorizationError('At least one valid knowledge scope is required', 'KNOWLEDGE_SCOPE_REQUIRED');
    }

    const allowed = new Set(context.allowedKnowledgeScopes || []);
    if (allowed.has('*')) return normalized;

    const denied = normalized.filter((scope) => !allowed.has(scope));
    if (denied.length) {
        throw new AuthorizationError('Requested knowledge scope is not allowed', 'KNOWLEDGE_SCOPE_FORBIDDEN');
    }
    return normalized;
}

export function tenantFilter (context) {
    requireTenantContext(context);
    return { tenantId: context.tenantId };
}

export function allowedScopesForListing (context) {
    requireTenantContext(context);
    const allowed = new Set(context.allowedKnowledgeScopes || []);
    if (allowed.has('*')) return null;
    return normalizeKnowledgeScopes([...allowed]);
}

export function isKnowledgeRecordVisible (context, record, authorizedScopes) {
    requireTenantContext(context);
    if (record?.tenantId !== context.tenantId) return false;
    const recordScopes = normalizeKnowledgeScopes(record?.scopes);
    return recordScopes.some((scope) => authorizedScopes.includes(scope));
}
