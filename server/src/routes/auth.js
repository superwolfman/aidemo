import express from 'express';
import { config } from '../config.js';
import { verifyPassword } from '../utils/password.js';
import { resolveActiveTenant } from '../security/tenantContext.js';
import { ROLES } from '../security/roles.js';
import { verifyCloudflareAccessJwt } from '../security/cloudflareAccess.js';
import {
    clearSessionCookie,
    setSessionCookie,
    signSessionToken,
    validateUserAccount
} from '../security/session.js';
import { SlidingWindowLimiter } from '../security/requestLimiter.js';

const loginLimiter = new SlidingWindowLimiter({
    limit: config.loginAttemptLimit,
    windowMs: config.loginAttemptWindowMs
});

function publicUser (user) {
    const {
        passwordHash,
        tokenVersion,
        accessIdentitySub,
        ...safeUser
    } = user || {};
    return { ...safeUser, _id: String(safeUser._id) };
}

function formatTenantName (tenantId) {
    return String(tenantId)
        .replace(/^tenant-?/, '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase());
}

function tenantView (user) {
    const { tenantId, role, tenants } = resolveActiveTenant(user);
    const list = (Array.isArray(tenants) && tenants.length)
        ? tenants
        : [{ tenantId: user.tenantId, role: user.role }];
    const tenantList = list.map((entry) => ({
        tenantId: String(entry.tenantId),
        name: entry.name || formatTenantName(entry.tenantId),
        role: String(entry.role || ROLES.MEMBER)
    }));
    const current = tenantList.find((entry) => entry.tenantId === tenantId) || tenantList[0];
    return {
        tenant: { id: tenantId, name: current?.name || formatTenantName(tenantId), role },
        tenants: tenantList
    };
}

function sessionResponse (res, user, authenticationMethod) {
    const token = signSessionToken(user, authenticationMethod);
    setSessionCookie(res, token);
    return {
        user: publicUser(user),
        ...tenantView(user),
        session: {
            authenticationMethod,
            expiresInSeconds: config.sessionTtlSeconds
        }
    };
}

async function telemetry (store, event) {
    try {
        await store.createTelemetry(event);
    } catch (error) {
        console.warn(`[auth] telemetry skipped: ${error.message}`);
    }
}

export async function resolveAccessUser (store, identity, options = {}) {
    const autoProvision = options.autoProvision ?? config.demoAutoProvision;
    const tenantId = options.tenantId || config.demoTenantId;
    const allowedKnowledgeScopes = options.allowedKnowledgeScopes || config.demoAllowedKnowledgeScopes;
    const accessExpiresAt = options.accessExpiresAt ?? config.demoAccessExpiresAt;
    let user = await store.findUserByEmail(identity.email);
    const accessPatch = {
        accessIdentitySub: identity.sub,
        lastAccessLoginAt: new Date().toISOString()
    };

    if (user) {
        validateUserAccount(user);
        user = await store.updateRecord('users', String(user._id), accessPatch) || user;
        return user;
    }
    if (!autoProvision) {
        const error = new Error('该邮箱尚未分配演示账号');
        error.statusCode = 403;
        error.code = 'DEMO_USER_NOT_PROVISIONED';
        throw error;
    }

    const createdAt = new Date().toISOString();
    const candidate = {
        name: identity.name || identity.email.split('@')[0],
        email: identity.email,
        role: ROLES.DEMO_VIEWER,
        tenantId,
        tenants: [{ tenantId, role: ROLES.DEMO_VIEWER }],
        activeTenantId: tenantId,
        allowedKnowledgeScopes,
        department: 'Interview Demo',
        authProvider: 'cloudflare-access',
        accessIdentitySub: identity.sub,
        tokenVersion: 0,
        disabledAt: null,
        demoExpiresAt: accessExpiresAt || null,
        lastAccessLoginAt: createdAt
    };
    try {
        return await store.createRecord('users', candidate);
    } catch (error) {
        // Two browser requests can race on first login; the unique email index wins.
        user = await store.findUserByEmail(identity.email);
        if (user) return user;
        throw error;
    }
}

export function authRouter (store, auth) {
    const router = express.Router();

    router.get('/bootstrap', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const mode = config.cloudflareAccessEnabled
            ? 'cloudflare-access'
            : (config.passwordLoginEnabled ? 'password' : 'disabled');
        return res.json({
            mode,
            passwordLoginEnabled: config.passwordLoginEnabled,
            accessLogoutUrl: config.cloudflareAccessEnabled
                ? `https://${config.cloudflareAccessTeamDomain}/cdn-cgi/access/logout`
                : null
        });
    });

    router.post('/access/session', async (req, res, next) => {
        if (!config.cloudflareAccessEnabled) {
            return res.status(404).json({ message: 'Cloudflare Access login is not enabled', code: 'ACCESS_NOT_ENABLED' });
        }
        const origin = String(req.headers.origin || '');
        if (origin && !config.clientOrigins.includes(origin)) {
            return res.status(403).json({ message: 'Request origin is not allowed', code: 'CSRF_ORIGIN_REJECTED' });
        }
        try {
            const assertion = req.headers['cf-access-jwt-assertion'];
            const identity = await verifyCloudflareAccessJwt(assertion, {
                teamDomain: config.cloudflareAccessTeamDomain,
                audience: config.cloudflareAccessAudience,
                allowedEmails: config.cloudflareAccessAllowedEmails
            });
            const user = await resolveAccessUser(store, identity);
            await telemetry(store, {
                type: 'auth.access.login',
                actorId: String(user._id),
                email: user.email,
                tenantId: resolveActiveTenant(user).tenantId,
                success: true,
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            return res.json(sessionResponse(res, user, 'cloudflare-access'));
        } catch (error) {
            await telemetry(store, {
                type: 'auth.access.login',
                success: false,
                code: error.code || 'ACCESS_LOGIN_FAILED',
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            return next(error);
        }
    });

    router.post('/login', async (req, res, next) => {
        if (!config.passwordLoginEnabled) {
            return res.status(404).json({ message: '密码登录已关闭', code: 'PASSWORD_LOGIN_DISABLED' });
        }
        const email = String(req.body?.email || '').trim().toLowerCase();
        const password = String(req.body?.password || '');
        // IP-level limiting prevents attackers bypassing the window with random emails.
        const rateKey = req.ip;
        const rate = loginLimiter.consume(rateKey);
        if (!rate.allowed) {
            res.setHeader('Retry-After', String(rate.retryAfterSeconds));
            return res.status(429).json({ message: '登录尝试过多，请稍后重试', code: 'LOGIN_RATE_LIMITED' });
        }

        try {
            const user = await store.findUserByEmail(email);
            if (!user || !verifyPassword(password, user.passwordHash)) {
                await telemetry(store, { type: 'auth.password.login', email, success: false, ip: req.ip });
                return res.status(401).json({ message: '邮箱或密码错误' });
            }
            validateUserAccount(user);
            loginLimiter.reset(rateKey);
            await telemetry(store, {
                type: 'auth.password.login',
                actorId: String(user._id),
                email,
                tenantId: resolveActiveTenant(user).tenantId,
                success: true,
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            return res.json(sessionResponse(res, user, 'password'));
        } catch (error) {
            return next(error);
        }
    });

    router.get('/me', auth, (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        return res.json({
            user: publicUser(req.user),
            ...tenantView(req.user),
            session: {
                authenticationMethod: req.session.payload.amr,
                expiresAt: new Date(req.session.payload.exp * 1000).toISOString()
            }
        });
    });

    router.post('/logout', auth, async (req, res, next) => {
        try {
            const nextVersion = Number(req.user.tokenVersion || 0) + 1;
            await store.updateRecord('users', String(req.user._id), {
                tokenVersion: nextVersion,
                lastLogoutAt: new Date().toISOString()
            });
            clearSessionCookie(res);
            await telemetry(store, {
                type: 'auth.logout',
                actorId: String(req.user._id),
                email: req.user.email,
                tenantId: req.auth.tenantId,
                success: true,
                ip: req.ip
            });
            return res.status(204).end();
        } catch (error) {
            return next(error);
        }
    });

    router.post('/switch-tenant', auth, async (req, res) => {
        if (req.auth.role === ROLES.DEMO_VIEWER) {
            return res.status(403).json({ message: '演示账号不允许切换租户', code: 'DEMO_TENANT_SWITCH_FORBIDDEN' });
        }
        const target = String(req.body?.tenantId || '').trim();
        if (!target) {
            return res.status(400).json({ message: 'tenantId is required', code: 'TENANT_ID_REQUIRED' });
        }

        const freshUser = await store.findUserById(String(req.user._id));
        if (!freshUser) {
            return res.status(401).json({ message: '用户不存在或已被禁用', code: 'USER_NOT_FOUND' });
        }

        const current = resolveActiveTenant(freshUser);
        const allowed = current.tenants.length
            ? current.tenants.map((tenant) => String(tenant.tenantId))
            : [String(freshUser.tenantId || '')];
        if (!allowed.includes(target)) {
            return res.status(403).json({ message: '当前用户不属于该租户', code: 'TENANT_NOT_ASSIGNED' });
        }

        let updatedUser = freshUser;
        if (target !== current.tenantId) {
            try {
                updatedUser = await store.updateRecord('users', String(freshUser._id), { activeTenantId: target });
            } catch (error) {
                console.error(`[auth] switch-tenant persist failed: ${error.message}`);
                return res.status(500).json({ message: '租户切换失败，请重试', code: 'PERSIST_FAILED' });
            }
        }
        if (!updatedUser) {
            return res.status(500).json({ message: '租户切换失败，用户记录不存在', code: 'USER_UPDATE_FAILED' });
        }

        await telemetry(store, {
            type: 'tenant.switch',
            actorId: String(updatedUser._id),
            email: updatedUser.email,
            fromTenantId: current.tenantId,
            toTenantId: target,
            success: true,
            userAgent: req.headers['user-agent'],
            ip: req.ip
        });
        return res.json(sessionResponse(res, updatedUser, req.session.payload.amr || 'password'));
    });

    return router;
}
