import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { verifyPassword } from '../utils/password.js';
import { resolveActiveTenant } from '../security/tenantContext.js';

function publicUser(user) {
    const { passwordHash, ...safeUser } = user || {};
    return { ...safeUser, _id: String(safeUser._id) };
}

function formatTenantName(tenantId) {
    return String(tenantId)
        .replace(/^tenant-?/, '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function tenantView(user) {
    const { tenantId, role, tenants } = resolveActiveTenant(user);
    const list = (Array.isArray(tenants) && tenants.length)
        ? tenants
        : [{ tenantId: user.tenantId, role: user.role }];
    const tenantList = list.map((entry) => ({
        tenantId: String(entry.tenantId),
        name: entry.name || formatTenantName(entry.tenantId),
        role: String(entry.role || 'member')
    }));
    const current = tenantList.find((entry) => entry.tenantId === tenantId) || tenantList[0];
    return {
        tenant: { id: tenantId, name: current?.name || formatTenantName(tenantId), role },
        tenants: tenantList
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
        const target = String(tenantId || '').trim();
        if (!target) {
            return res.status(400).json({ message: 'tenantId is required', code: 'TENANT_ID_REQUIRED' });
        }

        // 重新加载用户，避免使用登录时的快照；同时校验用户仍存在
        const freshUser = await store.findUserById(String(req.user._id));
        if (!freshUser) {
            return res.status(401).json({ message: '用户不存在或已被禁用', code: 'USER_NOT_FOUND' });
        }

        const current = resolveActiveTenant(freshUser);
        const allowed = (current.tenants && current.tenants.length)
            ? current.tenants.map((t) => String(t.tenantId))
            : [String(freshUser.tenantId || '')];

        if (!allowed.includes(target)) {
            return res.status(403).json({ message: '当前用户不属于该租户', code: 'TENANT_NOT_ASSIGNED' });
        }

        // 幂等：目标已经是当前激活租户，直接返回新 token，避免无意义写库
        if (target === current.tenantId) {
            const token = signToken(freshUser);
            const view = tenantView(freshUser);
            return res.json({ token, user: publicUser(freshUser), ...view });
        }

        // 更新 activeTenantId：只更新自己的记录，已通过上面的租户归属校验。
        // 用户表不使用业务数据的 tenantUserFilter（users 记录没有 createdBy）。
        let updatedUser;
        try {
            updatedUser = await store.updateRecord('users', String(freshUser._id), { activeTenantId: target });
        } catch (error) {
            console.error(`[auth] switch-tenant persist failed: ${error.message}`);
            return res.status(500).json({ message: '租户切换失败，请重试', code: 'PERSIST_FAILED' });
        }

        if (!updatedUser) {
            return res.status(500).json({ message: '租户切换失败，用户记录不存在', code: 'USER_UPDATE_FAILED' });
        }

        // 记录审计日志
        try {
            await store.createTelemetry({
                type: 'tenant.switch',
                actorId: String(updatedUser._id),
                email: updatedUser.email,
                fromTenantId: current.tenantId,
                toTenantId: target,
                success: true,
                userAgent: req.headers['user-agent'],
                ip: req.ip
            });
        } catch (error) {
            console.warn(`[auth] switch-tenant telemetry skipped: ${error.message}`);
        }

        // 用最新 activeTenantId 重新构造视图并签发 token
        const token = signToken(updatedUser);
        const view = tenantView(updatedUser);
        return res.json({ token, user: publicUser(updatedUser), ...view });
    });

    return router;
}
