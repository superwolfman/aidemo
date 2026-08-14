import { config } from '../config.js';

export const RUNTIME_MODEL_SETTING_KEY = 'llm-routing';
const MAX_FALLBACK_MODELS = 5;
const MAX_HISTORY = 50;

const dashscopeModels = [
    ['qwen3.7-plus', 'Qwen 3.7 Plus', 'general', true],
    ['qwen-plus-2025-07-28', 'Qwen Plus 2025-07-28', 'general', true],
    ['qwen-max', 'Qwen Max', 'general', true],
    ['qwen3.6-plus', 'Qwen 3.6 Plus', 'general', true],
    ['qwen3.7-flash-2026-07-15', 'Qwen 3.7 Flash 2026-07-15', 'general', true],
    ['qwen-long', 'Qwen Long', 'long-context', true],
    ['qwen3.5-35b-a3b', 'Qwen 3.5 35B A3B', 'general', true],
    ['qwen3-max-preview', 'Qwen 3 Max Preview', 'preview', true],
    ['qwen3.5-flash-2026-02-23', 'Qwen 3.5 Flash 2026-02-23', 'general', true],
    ['qwen-plus-0112', 'Qwen Plus 0112', 'general', true],
    ['qwen-plus', 'Qwen Plus', 'general', true],
    ['qwen-turbo', 'Qwen Turbo', 'general', true],
    ['qwen3-next-80b-a3b-thinking', 'Qwen 3 Next 80B A3B Thinking', 'reasoning', true],
    ['qwen3.5-27b', 'Qwen 3.5 27B', 'general', true],
    ['qwen3-14b', 'Qwen 3 14B', 'general', true],
    ['qwen-plus-2025-12-01', 'Qwen Plus 2025-12-01', 'general', true],
    ['qwen3-max-2025-09-23', 'Qwen 3 Max 2025-09-23', 'general', true],
    ['qwen-plus-character', 'Qwen Plus Character', 'character', false],
    ['qwen-math-turbo', 'Qwen Math Turbo', 'math', false],
    ['qwen-math-plus', 'Qwen Math Plus', 'math', false],
    ['qwen-math-plus-0919', 'Qwen Math Plus 0919', 'math', false],
    ['qwen-math-plus-latest', 'Qwen Math Plus Latest', 'math', false],
    ['qwen3-vl-235b-a22b-thinking', 'Qwen 3 VL 235B A22B Thinking', 'vision', false],
    ['qwen3-vl-32b-thinking', 'Qwen 3 VL 32B Thinking', 'vision', false],
    ['qwen-vl-plus', 'Qwen VL Plus', 'vision', false],
    ['qwen3-vl-8b-thinking', 'Qwen 3 VL 8B Thinking', 'vision', false],
    ['qwen3-vl-flash', 'Qwen 3 VL Flash', 'vision', false],
    ['qwen3-vl-flash-2025-10-15', 'Qwen 3 VL Flash 2025-10-15', 'vision', false],
    ['qwen-vl-ocr-1028', 'Qwen VL OCR 1028', 'ocr', false],
    ['qwen-mt-flash', 'Qwen MT Flash', 'translation', false],
    ['qwen3-coder-480b-a35b-instruct', 'Qwen 3 Coder 480B A35B', 'code', false],
    ['qwen3-coder-plus', 'Qwen 3 Coder Plus', 'code', false],
    ['qwen3-coder-flash', 'Qwen 3 Coder Flash', 'code', false],
    ['deepseek-r1-distill-qwen-7b', 'DeepSeek R1 Distill Qwen 7B', 'reasoning', false],
    ['qwen3.7-flash', 'Qwen 3.7 Flash', 'general', true],
    ['qwen3.6-35b-a3b', 'Qwen 3.6 35B A3B', 'general', true],
    ['qwen3.7-max', 'Qwen 3.7 Max', 'general', true],
    ['qwen3.7-max-2026-06-08', 'Qwen 3.7 Max 2026-06-08', 'general', true],
    ['qwen3.7-max-preview', 'Qwen 3.7 Max Preview', 'preview', true],
    ['qwen3.7-max-2026-05-20', 'Qwen 3.7 Max 2026-05-20', 'general', true],
    ['qwen3.7-plus-2026-05-26', 'Qwen 3.7 Plus 2026-05-26', 'general', true],
    ['qwen3.7-max-2026-05-17', 'Qwen 3.7 Max 2026-05-17', 'general', true]
];

export const runtimeModelCatalog = Object.freeze([
    ...dashscopeModels.map(([id, label, purpose, deliveryEligible]) => ({
        id,
        label,
        provider: 'dashscope',
        model: id,
        purpose,
        deliveryEligible,
        freeTierEligible: true,
        credentialSource: 'server-secret'
    })),
    { id: 'deepseek-chat', label: 'DeepSeek Chat', provider: 'deepseek', model: 'deepseek-chat', purpose: 'general', deliveryEligible: true, freeTierEligible: false, credentialSource: 'server-secret' },
    { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', provider: 'deepseek', model: 'deepseek-reasoner', purpose: 'reasoning', deliveryEligible: true, freeTierEligible: false, credentialSource: 'server-secret' },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', provider: 'dashscope', model: 'deepseek-v4-pro', purpose: 'reasoning', deliveryEligible: true, freeTierEligible: false, credentialSource: 'server-secret' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', provider: 'openai', model: 'gpt-4.1-mini', purpose: 'general', deliveryEligible: true, freeTierEligible: false, credentialSource: 'server-secret' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai', model: 'gpt-4o-mini', purpose: 'general', deliveryEligible: true, freeTierEligible: false, credentialSource: 'server-secret' }
]);

const catalogById = new Map(runtimeModelCatalog.map((item) => [item.id, item]));
let storeRef = null;
let activeSnapshot = null;
let mutationQueue = Promise.resolve();

function actorView (actor = {}) {
    return {
        id: String(actor.actorId || actor._id || 'system'),
        email: String(actor.email || actor.user?.email || 'system')
    };
}

function environmentDefault () {
    const provider = config.llmProvider || 'mock';
    const model = config.llmModel || (provider === 'dashscope' ? 'qwen-plus' : '');
    return {
        primary: { provider, model },
        fallbackChain: config.llmFallbackModels
            .map((id) => catalogById.get(id))
            .filter((item) => item?.deliveryEligible)
            .map((item) => ({ provider: item.provider, model: item.model })),
        fallbackPolicy: { triggers: ['quota_exhausted'], maxAttempts: MAX_FALLBACK_MODELS + 1 }
    };
}

function publicSnapshot (record) {
    if (!record) return null;
    return {
        _id: record._id,
        key: record.key,
        version: Number(record.version || 1),
        primary: record.primary,
        fallbackChain: Array.isArray(record.fallbackChain) ? record.fallbackChain : [],
        fallbackPolicy: record.fallbackPolicy || { triggers: ['quota_exhausted'] },
        updatedBy: record.updatedBy,
        updatedAt: record.updatedAt || record.createdAt,
        changeNote: record.changeNote || '',
        source: 'runtime_settings'
    };
}

function validateModel (value, label) {
    const model = String(value?.model || '').trim();
    const provider = String(value?.provider || '').trim();
    const catalogItem = catalogById.get(model);
    if (!catalogItem || catalogItem.provider !== provider) {
        const error = new Error(`${label} 不在服务端模型目录中`);
        error.statusCode = 400;
        error.code = 'RUNTIME_MODEL_NOT_ALLOWED';
        throw error;
    }
    if (!catalogItem.deliveryEligible) {
        const error = new Error(`${catalogItem.label} 是 ${catalogItem.purpose} 专用模型，不能加入通用交付链`);
        error.statusCode = 400;
        error.code = 'RUNTIME_MODEL_INCOMPATIBLE';
        throw error;
    }
    if (!config.llmApiKeys?.[provider]) {
        const error = new Error(`${catalogItem.label} 的 ${provider} 服务端凭据未配置`);
        error.statusCode = 400;
        error.code = 'RUNTIME_MODEL_CREDENTIAL_MISSING';
        throw error;
    }
    return { provider, model };
}

function validateValue ({ primary, fallbackChain = [] }) {
    const normalizedPrimary = validateModel(primary, '主模型');
    if (!Array.isArray(fallbackChain) || fallbackChain.length > MAX_FALLBACK_MODELS) {
        const error = new Error(`备用模型最多配置 ${MAX_FALLBACK_MODELS} 个`);
        error.statusCode = 400;
        error.code = 'RUNTIME_FALLBACK_LIMIT';
        throw error;
    }
    const normalizedFallback = fallbackChain.map((item, index) => validateModel(item, `备用模型 ${index + 1}`));
    const ids = [normalizedPrimary, ...normalizedFallback].map((item) => `${item.provider}:${item.model}`);
    if (new Set(ids).size !== ids.length) {
        const error = new Error('主模型和备用模型链不能重复');
        error.statusCode = 400;
        error.code = 'RUNTIME_MODEL_DUPLICATE';
        throw error;
    }
    return {
        primary: normalizedPrimary,
        fallbackChain: normalizedFallback,
        fallbackPolicy: { triggers: ['quota_exhausted'], maxAttempts: normalizedFallback.length + 1 }
    };
}

async function historyRecords () {
    if (!storeRef) return [];
    const records = await storeRef.listRecords('runtime_setting_versions', MAX_HISTORY);
    return records
        .filter((item) => item.settingKey === RUNTIME_MODEL_SETTING_KEY)
        .sort((a, b) => Number(b.version) - Number(a.version));
}

async function persistVersion (record, action, actor, rollbackFromVersion = null) {
    try {
        return await storeRef.createRecord('runtime_setting_versions', {
            settingKey: RUNTIME_MODEL_SETTING_KEY,
            version: record.version,
            primary: record.primary,
            fallbackChain: record.fallbackChain,
            fallbackPolicy: record.fallbackPolicy,
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

export async function initializeRuntimeModelSettings (store) {
    storeRef = store;
    const records = await store.listRecords('runtime_settings', 100);
    let record = records.find((item) => item.key === RUNTIME_MODEL_SETTING_KEY);
    if (!record) {
        const defaults = environmentDefault();
        try {
            record = await store.createRecord('runtime_settings', {
                key: RUNTIME_MODEL_SETTING_KEY,
                version: 1,
                ...defaults,
                updatedBy: actorView(),
                changeNote: '由服务端环境变量初始化；后续变更由运行时设置管理。'
            });
        } catch (error) {
            record = (await store.listRecords('runtime_settings', 100)).find((item) => item.key === RUNTIME_MODEL_SETTING_KEY);
            if (!record) throw error;
        }
    }
    const hasCurrentVersion = (await historyRecords()).some((item) => Number(item.version) === Number(record.version));
    if (!hasCurrentVersion) await persistVersion(record, 'initialize', record.updatedBy || actorView());
    activeSnapshot = publicSnapshot(record);
    return activeSnapshot;
}

export function getRuntimeModelSettingsSnapshot () {
    return activeSnapshot || { key: RUNTIME_MODEL_SETTING_KEY, version: 0, ...environmentDefault(), source: 'environment' };
}

export function getRuntimeModelCatalog () {
    return runtimeModelCatalog.map((item) => ({
        ...item,
        credentialConfigured: Boolean(config.llmApiKeys?.[item.provider]),
        description: `${item.purpose} · ${item.deliveryEligible ? '通用交付链兼容' : '专用场景模型'}`,
        freeTierStatus: item.freeTierEligible ? 'console-managed' : 'not-applicable'
    }));
}

export function assertRuntimeModelTestable ({ provider, model }) {
    return validateModel({ provider, model }, '待测试模型');
}

export async function getRuntimeModelSettingsView () {
    return { setting: getRuntimeModelSettingsSnapshot(), catalog: getRuntimeModelCatalog(), history: await historyRecords() };
}

export async function publishRuntimeModelSettings ({ primary, fallbackChain, expectedVersion, changeNote }, actor = {}) {
    const execute = async () => {
        const current = getRuntimeModelSettingsSnapshot();
        if (Number(expectedVersion) !== Number(current.version)) {
            const error = new Error('模型设置已被其他管理员修改，请刷新后重试');
            error.statusCode = 409;
            error.code = 'RUNTIME_SETTINGS_VERSION_CONFLICT';
            throw error;
        }
        const nextValue = validateValue({ primary, fallbackChain });
        const updatedBy = actorView(actor);
        const updatedAt = new Date().toISOString();
        const recordId = activeSnapshot?._id || current._id || (await storeRef.listRecords('runtime_settings', 100)).find((item) => item.key === RUNTIME_MODEL_SETTING_KEY)?._id;
        if (!recordId) {
            const error = new Error('运行时模型设置不存在，请重新初始化服务');
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
            const latest = (await storeRef.listRecords('runtime_settings', 100)).find((item) => item.key === RUNTIME_MODEL_SETTING_KEY);
            if (latest) activeSnapshot = publicSnapshot(latest);
            const error = new Error('模型设置已被其他管理员修改，请刷新后重试');
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

export async function rollbackRuntimeModelSettings ({ targetVersion, expectedVersion, changeNote }, actor = {}) {
    const target = (await historyRecords()).find((item) => Number(item.version) === Number(targetVersion));
    if (!target) {
        const error = new Error('找不到要回滚的模型设置版本');
        error.statusCode = 404;
        error.code = 'RUNTIME_SETTINGS_VERSION_NOT_FOUND';
        throw error;
    }
    const result = await publishRuntimeModelSettings({
        primary: target.primary,
        fallbackChain: target.fallbackChain,
        expectedVersion,
        changeNote: String(changeNote || `回滚到 v${targetVersion}`)
    }, actor);
    const versions = await historyRecords();
    const latest = versions.find((item) => Number(item.version) === Number(result.version));
    if (latest) await storeRef.updateRecord('runtime_setting_versions', latest._id, { action: 'rollback', rollbackFromVersion: Number(targetVersion) });
    return result;
}

export function __resetRuntimeModelSettingsForTests () {
    storeRef = null;
    activeSnapshot = null;
    mutationQueue = Promise.resolve();
}
