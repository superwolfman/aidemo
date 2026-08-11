import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { resolveActiveTenant } from './tenantContext.js';

export class SessionSecurityError extends Error {
    constructor (message, code = 'SESSION_INVALID', statusCode = 401) {
        super(message);
        this.name = 'SessionSecurityError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

export function parseCookieHeader (header = '') {
    return String(header).split(';').reduce((cookies, part) => {
        const index = part.indexOf('=');
        if (index < 1) return cookies;
        const name = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        if (name) cookies[name] = decodeURIComponent(value);
        return cookies;
    }, {});
}

export function getRequestSessionToken (req) {
    const cookies = parseCookieHeader(req.headers.cookie);
    if (cookies[config.sessionCookieName]) {
        return { token: cookies[config.sessionCookieName], source: 'cookie' };
    }
    const authorization = req.headers.authorization || '';
    if (config.legacyBearerEnabled && authorization.startsWith('Bearer ')) {
        return { token: authorization.slice(7), source: 'bearer' };
    }
    return { token: null, source: null };
}

export function signSessionToken (user, authenticationMethod) {
    const { tenantId, role } = resolveActiveTenant(user);
    return jwt.sign(
        {
            sub: String(user._id),
            email: user.email,
            role,
            tid: tenantId,
            ver: Number(user.tokenVersion || 0),
            amr: authenticationMethod,
            jti: crypto.randomUUID()
        },
        config.jwtSecret,
        { expiresIn: config.sessionTtlSeconds }
    );
}

export function setSessionCookie (res, token) {
    res.cookie(config.sessionCookieName, token, {
        httpOnly: true,
        secure: config.sessionCookieSecure,
        sameSite: 'lax',
        path: '/',
        maxAge: config.sessionTtlSeconds * 1000
    });
}

export function clearSessionCookie (res) {
    res.clearCookie(config.sessionCookieName, {
        httpOnly: true,
        secure: config.sessionCookieSecure,
        sameSite: 'lax',
        path: '/'
    });
}

export function validateUserSession (user, payload, nowMs = Date.now()) {
    validateUserAccount(user, nowMs);
    if (Number(payload.ver || 0) !== Number(user.tokenVersion || 0)) {
        throw new SessionSecurityError('Session has been revoked', 'SESSION_REVOKED');
    }

    const active = resolveActiveTenant(user);
    const assignedTenantIds = active.tenants.length
        ? active.tenants.map((entry) => String(entry.tenantId))
        : [String(user.tenantId || '')];
    if (!assignedTenantIds.includes(String(payload.tid || ''))) {
        throw new SessionSecurityError('Session tenant is no longer assigned', 'TENANT_NOT_ASSIGNED', 403);
    }
    return user;
}

export function validateUserAccount (user, nowMs = Date.now()) {
    if (!user) {
        throw new SessionSecurityError('Invalid user', 'USER_NOT_FOUND');
    }
    if (user.disabledAt) {
        throw new SessionSecurityError('User access has been disabled', 'USER_DISABLED', 403);
    }
    if (user.demoExpiresAt && Date.parse(user.demoExpiresAt) <= nowMs) {
        throw new SessionSecurityError('Demo access has expired', 'DEMO_ACCESS_EXPIRED', 403);
    }
    return user;
}

export function isAllowedCookieOrigin (req) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    const origin = String(req.headers.origin || '');
    return Boolean(origin && config.clientOrigins.includes(origin));
}
