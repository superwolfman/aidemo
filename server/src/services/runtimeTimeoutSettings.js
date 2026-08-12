import { config } from '../config.js';

export const RUNTIME_TIMEOUT_SETTING_KEY = 'llm-timeout-policy';
const MAX_HISTORY = 50;

// 校验区间（业界合理范围，防止误配成 1ms 导致全量超时）
const RANGES = {
    requestTimeoutMs: { min: 5000, max: 300000 },
    streamTotalTimeoutMs: { min: 10000, max: 600000 },
    firstTokenTimeoutMs: { min: 3000, max: 120000 },
    idleTimeoutMs: { min: 3000, max: 120000 },
    connectProbeMs: { min: 3000, max: 60000 }
};

const FALLBACK_TRIGGERS = new Set(['quota_exhausted', 'timeout', 'connect_error']);
const RETRYABLE_ERRORS = new Set(['timeout', 'connect_error', '5xx']);

let storeRef = null;
let activeSnapshot = null;
let mutationQueue = Promise.resolve();

function actorView (actor = {}) {
    return {
        id: String(actor.actorId || actor._id || 'system'),
        email: String(actor.email || actor.user?.email || 'system')
    };
}

function numberFromEnv (name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
}

/**
 * 环境默认值：仅作为初始化种子和 LLM_TIMEOUT_FORCE=true 紧急覆盖。
 * 一旦运行时设置发布，运行时值优先生效。
 */
export function environmentDefault () {
    return {
        defaults: {
            requestTimeoutMs: numberFromEnv('LLM_TIMEOUT_MS', 60000),
            streamTotalTimeoutMs: numberFromEnv('LLM_STREAM_TIMEOUT_MS', 120000),
            firstTokenTimeoutMs: numberFromEnv('LLM_FIRST_TOKEN_TIMEOUT_MS', 30000),
            idleTimeoutMs: numberFromEnv('LLM_IDLE_TIMEOUT_MS', 15000),
            connectProbeMs: numberFromEnv('LLM_CONNECT_PROBE_MS', 15000)
        },
        perModel: {},
        fallbackPolicy: {
            triggers: ['quota_exhausted', 'timeout', 'connect_error'],
            maxAttempts: 4
        },
        retryPolicy: {
            maxRetries: 1,
            retryableErrors: ['timeout', 'connect_error', '5xx'],
            backoffBaseMs: 800,
            backoffMaxMs: 4000
        }
    };
}

export function isTimeoutForceEnabled () {
    return process.env.LLM_TIMEOUT_FORCE === 'true';
}

function publicSnapshot (record) {
    if (!record) return null;
    return {
        _id: record._id,
        key: record.key,
        version: Number(record.version || 1),
        defaults: record.defaults,
        perModel: record.perModel || {},
        fallbackPolicy: record.fallbackPolicy || { triggers: ['quota_exhausted'] },
        retryPolicy: record.retryPolicy || { maxRetries: 0 },
        updatedBy: record.updatedBy,
        updatedAt: record.updatedAt || record.createdAt,
        changeNote: record.changeNote || '',
        source: 'runtime_settings'
    };
}

function clampLabel (field) {
    const range = RANGES[field];
    return range ? `${field} 需在 ${range.min}-${range.max}ms 之间` : field;
}

function validateTimeoutField (value, field, label) {
    const range = RANGES[field];
    if (!range) return value;
    const num = Number(value);
    if (!Number.isFinite(num) || num < range.min || num > range.max) {
        const error = new Error(`${label}：${clampLabel(field)}`);
        error.statusCode = 400;
        error.code = 'RUNTIME_TIMEOUT_OUT_OF_RANGE';
        throw error;
    }
    return num;
}

function validateDefaults (defaults) {
    if (!defaults || typeof defaults !== 'object') {
        const error = new Error('defaults 必须是对象');
        error.statusCode = 400;
        error.code = 'RUNTIME_TIMEOUT_INVALID';
        throw error;
    }
    const out = {};
    for (const field of Object.keys(RANGES)) {
        out[field] = validateTimeoutField(defaults[field], field, '默认值');
    }
    return out;
}

function validatePerModel (perModel) {
    if (perModel == null) return {};
    if (typeof perModel !== 'object' || Array.isArray(perModel)) {
        const error = new Error('perModel 必须是对象');
        error.statusCode = 400;
        error.code = 'RUNTIME_TIMEOUT_INVALID';
        throw error;
    }
    const out = {};
    for (const [model, override] of Object.entries(perModel)) {
        const key = String(model || '').trim();
        if (!key) {
            const error = new Error('perModel 的模型键不能为空');
            error.statusCode = 400;
            error.code = 'RUNTIME_TIMEOUT_INVALID';
            throw error;
        }
        if (!override || typeof override !== 'object') {
            const error = new Error(`perModel.${key} 必须是对象`);
            error.statusCode = 400;
            error.code = 'RUNTIME_TIMEOUT_INVALID';
            throw error;
        }
        const cleaned = {};
        for (const field of Object.keys(RANGES)) {
            if (override[field] === undefined || override[field] === null) continue;
            cleaned[field] = validateTimeoutField(override[field], field, `perModel.${key}`);
        }
        out[key] = cleaned;
    }
    return out;
}

function validateFallbackPolicy (policy) {
    const value = policy || {};
    const triggers = Array.isArray(value.triggers) ? value.triggers : ['quota_exhausted'];
    const invalid = triggers.filter((item) => !FALLBACK_TRIGGERS.has(item));
    if (invalid.length) {
        const error = new Error(`fallbackPolicy.triggers 含非法值: ${invalid.join(', ')}`);
        error.statusCode = 400;
        error.code = 'RUNTIME_TIMEOUT_INVALID';
        throw error;
    }
    const maxAttempts = Math.min(Math.max(Number(value.maxAttempts || 4), 1), 6);
    return { triggers, maxAttempts };
}

function validateRetryPolicy (policy) {
    const value = policy || {};
    const maxRetries = Math.min(Math.max(Number(value.maxRetries ?? 1), 0), 3);
    const retryableErrors = Array.isArray(value.retryableErrors)
        ? value.retryableErrors.filter((item) => RETRYABLE_ERRORS.has(item))
        : ['timeout', 'connect_error', '5xx'];
    const backoffBaseMs = Math.min(Math.max(Number(value.backoffBaseMs ?? 800), 100), 10000);
    const backoffMaxMs = Math.min(Math.max(Number(value.backoffMaxMs ?? 4000), backoffBaseMs), 60000);
    return { maxRetries, retryableErrors, backoffBaseMs, backoffMaxMs };
}

function validateValue ({ defaults, perModel, fallbackPolicy, retryPolicy }) {
    return {
        defaults: validateDefaults(defaults),
        perModel: validatePerModel(perModel),
        fallbackPolicy: validateFallbackPolicy(fallbackPolicy),
        retryPolicy: validateRetryPolicy(retryPolicy)
    };
}

async function historyRecords () {
    if (!storeRef) return [];
    const records = await storeRef.listRecords('runtime_setting_versions', MAX_HISTORY);
    return records
        .filter((item) => item.settingKey === RUNTIME_TIMEOUT_SETTING_KEY)
        .sort((a, b) => Number(b.version) - Number(a.version));
}

async function persistVersion (record, action, actor, rollbackFromVersion = null) {
    if (!storeRef) return null;
    try {
        return await storeRef.createRecord('runtime_setting_versions', {
            settingKey: RUNTIME_TIMEOUT_SETTING_KEY,
            version: record.version,
            defaults: record.defaults,
            perModel: record.perModel,
            fallbackPolicy: record.fallbackPolicy,
            retryPolicy: record.retryPolicy,
            action,
            rollbackFromVersion,
            changeNote: record.changeNote || '',
            changedBy: actor,
            changedAt: record.updatedAt || new Date().toISOString()
        });
    } catch (error) {
        const existing = (await historyRecords()).find((item) => Number(item.version) === Number(record.version));
        if (existing) return existing;
        throw error;
    }
}

export async function initializeRuntimeTimeoutSettings (store) {
    storeRef = store;
    const records = await store.listRecords('runtime_settings', 100);
    let record = records.find((item) => item.key === RUNTIME_TIMEOUT_SETTING_KEY);
    if (!record) {
        const defaults = environmentDefault();
        try {
            record = await store.createRecord('runtime_settings', {
                key: RUNTIME_TIMEOUT_SETTING_KEY,
                version: 1,
                ...defaults,
                updatedBy: actorView(),
                changeNote: '由服务端环境变量初始化；后续变更由运行时设置管理。'
            });
        } catch (error) {
            record = (await store.listRecords('runtime_settings', 100)).find((item) => item.key === RUNTIME_TIMEOUT_SETTING_KEY);
            if (!record) throw error;
        }
    }
    const hasCurrentVersion = (await historyRecords()).some((item) => Number(item.version) === Number(record.version));
    if (!hasCurrentVersion) await persistVersion(record, 'initialize', record.updatedBy || actorView());
    activeSnapshot = publicSnapshot(record);
    return activeSnapshot;
}

export function getRuntimeTimeoutSettingsSnapshot () {
    if (activeSnapshot) return activeSnapshot;
    return {
        key: RUNTIME_TIMEOUT_SETTING_KEY,
        version: 0,
        ...environmentDefault(),
        source: 'environment'
    };
}

export async function getRuntimeTimeoutSettingsView () {
    return { setting: getRuntimeTimeoutSettingsSnapshot(), history: await historyRecords() };
}

/**
 * 解析指定模型的有效超时配置。
 * 优先级：LLM_TIMEOUT_FORCE=true 紧急覆盖 > 运行时 perModel 覆盖 > 运行时 defaults > env 种子。
 */
export function resolveTimeoutsForModel (model) {
    const snapshot = getRuntimeTimeoutSettingsSnapshot();
    const base = isTimeoutForceEnabled() ? environmentDefault().defaults : snapshot.defaults;
    const override = !isTimeoutForceEnabled() ? (snapshot.perModel?.[model] || {}) : {};
    return { ...base, ...override };
}

export function shouldFallbackOn (reason) {
    const policy = getRuntimeTimeoutSettingsSnapshot().fallbackPolicy || { triggers: ['quota_exhausted'] };
    return Array.isArray(policy.triggers) ? policy.triggers.includes(reason) : false;
}

export async function publishRuntimeTimeoutSettings ({ defaults, perModel, fallbackPolicy, retryPolicy, expectedVersion, changeNote }, actor = {}) {
    const execute = async () => {
        const current = getRuntimeTimeoutSettingsSnapshot();
        if (Number(expectedVersion) !== Number(current.version)) {
            const error = new Error('超时策略已被其他管理员修改，请刷新后重试');
            error.statusCode = 409;
            error.code = 'RUNTIME_SETTINGS_VERSION_CONFLICT';
            throw error;
        }
        const nextValue = validateValue({ defaults, perModel, fallbackPolicy, retryPolicy });
        const updatedBy = actorView(actor);
        const updatedAt = new Date().toISOString();
        const recordId = activeSnapshot?._id || current._id || (await storeRef.listRecords('runtime_settings', 100)).find((item) => item.key === RUNTIME_TIMEOUT_SETTING_KEY)?._id;
        if (!recordId) {
            const error = new Error('运行时超时策略不存在，请重新初始化服务');
            error.statusCode = 503;
            error.code = 'RUNTIME_SETTINGS_NOT_INITIALIZED';
            throw error;
        }
        const patch = {
            ...nextValue,
            version: current.version + 1,
            updatedBy,
            updatedAt,
            changeNote: String(changeNote || '').trim().slice(0, 300)
        };
        const record = typeof storeRef.compareAndSetRecord === 'function'
            ? await storeRef.compareAndSetRecord('runtime_settings', recordId, current.version, patch)
            : await storeRef.updateRecord('runtime_settings', recordId, patch);
        if (!record) {
            const latest = (await storeRef.listRecords('runtime_settings', 100)).find((item) => item.key === RUNTIME_TIMEOUT_SETTING_KEY);
            if (latest) activeSnapshot = publicSnapshot(latest);
            const error = new Error('超时策略已被其他管理员修改，请刷新后重试');
            error.statusCode = 409;
            error.code = 'RUNTIME_SETTINGS_VERSION_CONFLICT';
            throw error;
        }
        activeSnapshot = publicSnapshot(record);
        await persistVersion(activeSnapshot, 'publish', updatedBy);
        return activeSnapshot;
    };
    mutationQueue = mutationQueue.then(execute, execute);
    return mutationQueue;
}

export async function rollbackRuntimeTimeoutSettings ({ targetVersion, expectedVersion, changeNote }, actor = {}) {
    const target = (await historyRecords()).find((item) => Number(item.version) === Number(targetVersion));
    if (!target) {
        const error = new Error('找不到要回滚的超时策略版本');
        error.statusCode = 404;
        error.code = 'RUNTIME_SETTINGS_VERSION_NOT_FOUND';
        throw error;
    }
    const result = await publishRuntimeTimeoutSettings({
        defaults: target.defaults,
        perModel: target.perModel,
        fallbackPolicy: target.fallbackPolicy,
        retryPolicy: target.retryPolicy,
        expectedVersion,
        changeNote: String(changeNote || `回滚到 v${targetVersion}`)
    }, actor);
    const versions = await historyRecords();
    const latest = versions.find((item) => Number(item.version) === Number(result.version));
    if (latest) await storeRef.updateRecord('runtime_setting_versions', latest._id, { action: 'rollback', rollbackFromVersion: Number(targetVersion) });
    return result;
}

export function __resetRuntimeTimeoutSettingsForTests () {
    storeRef = null;
    activeSnapshot = null;
    mutationQueue = Promise.resolve();
}
