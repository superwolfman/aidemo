export async function recordAuthorizationDenied (store, req, details = {}) {
    const event = {
        type: details.type || 'security.authorization.denied',
        actorId: req.auth?.actorId || (req.user?._id ? String(req.user._id) : null),
        email: req.user?.email || null,
        tenantId: req.auth?.tenantId || null,
        role: req.auth?.role || null,
        area: details.area || null,
        method: String(req.method || '').toUpperCase(),
        path: String(req.originalUrl || req.path || '').split('?')[0],
        code: details.code || 'AUTHORIZATION_DENIED',
        ip: req.ip || null,
        userAgent: req.headers?.['user-agent'] || null,
        requestId: req.headers?.['x-request-id'] || null
    };
    try {
        await store.createTelemetry(event);
    } catch (error) {
        console.warn(`[security-audit] authorization denial was not persisted: ${error.message}`);
    }
}
