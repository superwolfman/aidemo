import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { verifyPassword } from '../utils/password.js';
import { resolveActiveTenant } from '../security/tenantContext.js';

function publicUser(user) {
    const { passwordHash, ...safeUser } = user || {};
    return { ...safeUser, _id: String(safeUser._id) };
}

function tenantView(user) {
    const { tenantId, role, tenants } = resolveActiveTenant(user);
    const list = (Array.isArray(tenants) && tenants.length)
        ? tenants
        : [{ tenantId: user.tenantId, role: user.role }];
    return {
        tenant: { id: tenantId, name: tenantId, role },
        tenants: list.map((entry) => ({
            tenantId: String(entry.tenantId),
            role: String(entry.role || 'member')
        }))
    };
}

function signToken(user) {
    const { tenantId, role } = resolveActiveTenant(user);
    return jwt.sign(
        { sub: String(user._id), email: user.email, role, tid: tenantId },
        config.jwtSecret,
        { expiresIn: '8h' }
    );
}

export function authRouter(store, auth) {
    const router = express.Router();

    router.post('/login', async (req, res) => {
        const { email, password } = req.body || {};
        const user = await store.findUserByEmail(email);

        if (!user || !verifyPassword(password, user.passwordHash)) {
            return res.status(401).json({ message: '邮箱或密码错误' });
        }

        const safeUser = publicUser(user);
        const token = signToken(user);
        const view = tenantView(user);
        return res.json({ token, user: safeUser, ...view });
    });

    router.get('/me', auth, (req, res) => {
        const safeUser = publicUser(req.user);
        const view = tenantView(req.user);
        return res.json({ user: safeUser, ...view });
    });

    router.post('/switch-tenant', auth, async (req, res) => {
        const { tenantId } = req.body || {};
        if (!tenantId) {
            return res.status(400).json({ message: 'tenantId is required' });
        }

        const current = resolveActiveTenant(req.user);
        const target = String(tenantId).trim();
        const allowed = (current.tenants && current.tenants.length)
            ? current.tenants.map((t) => String(t.tenantId))
            : [String(req.user.tenantId || '')];

        if (!allowed.includes(target)) {
            return res.status(403).json({ message: '当前用户不属于该租户', code: 'TENANT_NOT_ASSIGNED' });
        }

        // 持久化当前激活租户，保证刷新/新会话后仍停留在该租户
        try {
            await store.updateRecord('users', String(req.user._id), { activeTenantId: target });
        } catch (error) {
            console.warn(`[auth] switch-tenant persist skipped: ${error.message}`);
        }

        // 用最新 activeTenantId 重新构造视图并签发 token
        const updatedUser = { ...req.user, activeTenantId: target };
        const token = signToken(updatedUser);
        const view = tenantView(updatedUser);
        return res.json({ token, user: publicUser(updatedUser), ...view });
    });

    return router;
}
