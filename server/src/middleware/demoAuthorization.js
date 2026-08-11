import { config } from '../config.js';
import { ROLES } from '../security/roles.js';
import { SlidingWindowLimiter } from '../security/requestLimiter.js';
import { recordAuthorizationDenied } from '../security/authorizationAudit.js';

const runLimiter = new SlidingWindowLimiter({
    limit: config.demoRunLimitPerHour,
    windowMs: 60 * 60 * 1000
});

const ALLOWED_DEMO_MUTATIONS = Object.freeze({
    copilot: [
        /^POST \/sessions$/,
        /^POST \/knowledge\/search$/,
        /^POST \/sessions\/[^/]+\/messages\/stream$/
    ],
    agentStudio: [
        /^POST \/sessions$/,
        /^POST \/sessions\/[^/]+\/runs\/stream$/
    ]
});

const RUN_PATTERNS = [
    /^POST \/sessions\/[^/]+\/messages\/stream$/,
    /^POST \/sessions\/[^/]+\/runs\/stream$/
];

export function evaluateDemoPermission ({ role, area, method, path }) {
    if (role !== ROLES.DEMO_VIEWER) return { allowed: true };

    const operation = `${String(method).toUpperCase()} ${path}`;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
        if (/\/artifacts\/[^/]+\/export$/.test(path)) {
            return { allowed: false, code: 'DEMO_EXPORT_FORBIDDEN' };
        }
        return { allowed: true };
    }
    const allowed = (ALLOWED_DEMO_MUTATIONS[area] || []).some((pattern) => pattern.test(operation));
    return allowed
        ? { allowed: true, consumesRunQuota: RUN_PATTERNS.some((pattern) => pattern.test(operation)) }
        : { allowed: false, code: 'DEMO_READ_ONLY' };
}

export function enforceDemoPermissions (store, area) {
    return async (req, res, next) => {
        const permission = evaluateDemoPermission({
            role: req.auth?.role,
            area,
            method: req.method,
            path: req.path
        });
        if (!permission.allowed) {
            await recordAuthorizationDenied(store, req, {
                area,
                code: permission.code
            });
            return res.status(403).json({
                message: '受限演示账号可创建限额 Demo Run 并查看生成结果，但不可执行编辑、确认、导出或复评分操作',
                code: permission.code
            });
        }
        if (permission.consumesRunQuota) {
            const quota = runLimiter.consume(req.auth.actorId);
            if (!quota.allowed) {
                await recordAuthorizationDenied(store, req, {
                    type: 'security.demo.quota.denied',
                    area,
                    code: 'DEMO_RUN_QUOTA_EXCEEDED'
                });
                res.setHeader('Retry-After', String(quota.retryAfterSeconds));
                return res.status(429).json({
                    message: '演示运行额度已用完，请稍后再试',
                    code: 'DEMO_RUN_QUOTA_EXCEEDED'
                });
            }
        }
        return next();
    };
}
