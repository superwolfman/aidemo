import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import {
    __resetRuntimeModelSettingsForTests,
    getRuntimeModelSettingsSnapshot,
    getRuntimeModelSettingsView,
    initializeRuntimeModelSettings,
    publishRuntimeModelSettings,
    rollbackRuntimeModelSettings
} from '../src/services/runtimeModelSettings.js';

class MemoryStore {
    constructor () { this.data = {}; this.sequence = 0; }
    async listRecords (collection, limit = 100) { return (this.data[collection] || []).slice(0, limit); }
    async createRecord (collection, payload) {
        this.data[collection] ||= [];
        const timestamp = new Date(Date.now() + this.sequence).toISOString();
        const record = { _id: String(++this.sequence), ...payload, createdAt: timestamp, updatedAt: timestamp };
        this.data[collection].unshift(record);
        return record;
    }
    async updateRecord (collection, id, patch) {
        const index = (this.data[collection] || []).findIndex((item) => item._id === id);
        if (index < 0) return null;
        this.data[collection][index] = { ...this.data[collection][index], ...patch, updatedAt: patch.updatedAt || new Date().toISOString() };
        return this.data[collection][index];
    }
}

function withDashscopeConfig () {
    const original = {
        provider: config.llmProvider,
        model: config.llmModel,
        fallback: config.llmFallbackModels,
        key: config.llmApiKeys.dashscope
    };
    config.llmProvider = 'dashscope';
    config.llmModel = 'deepseek-v4.1-flash-1017';
    config.llmFallbackModels = [];
    config.llmApiKeys.dashscope = 'test-secret';
    return () => {
        config.llmProvider = original.provider;
        config.llmModel = original.model;
        config.llmFallbackModels = original.fallback;
        config.llmApiKeys.dashscope = original.key;
    };
}

test('runtime settings persist, become active immediately, and preserve actor history', async () => {
    const restore = withDashscopeConfig();
    const store = new MemoryStore();
    __resetRuntimeModelSettingsForTests();
    try {
        const initial = await initializeRuntimeModelSettings(store);
        assert.equal(initial.version, 1);
        assert.equal(initial.primary.model, 'deepseek-v4.1-flash-1017');

        const published = await publishRuntimeModelSettings({
            primary: { provider: 'dashscope', model: 'qwen4-max' },
            fallbackChain: [{ provider: 'dashscope', model: 'kimi-k3.1-pro' }],
            expectedVersion: 1,
            changeNote: 'quota capacity update'
        }, { actorId: 'admin-1', email: 'admin@example.invalid' });

        assert.equal(published.version, 2);
        assert.equal(getRuntimeModelSettingsSnapshot().primary.model, 'qwen4-max');
        assert.equal(getRuntimeModelSettingsSnapshot().fallbackChain[0].model, 'kimi-k3.1-pro');
        const view = await getRuntimeModelSettingsView();
        assert.equal(view.history[0].version, 2);
        assert.equal(view.history[0].changedBy.email, 'admin@example.invalid');
        assert.equal(view.history[0].changeNote, 'quota capacity update');
        const availableDeliveryModels = [
            'qwen4-max',
            'kimi-k3.1-pro',
            'qwen3.8-max-0902',
            'deepseek-v4.1-flash-1017',
            'deepseek-v4.1-flash'
        ];
        for (const model of availableDeliveryModels) {
            const catalogItem = view.catalog.find((item) => item.model === model);
            assert.equal(catalogItem?.provider, 'dashscope');
            assert.equal(catalogItem?.deliveryEligible, true);
            assert.equal(catalogItem?.freeTierStatus, 'console-managed');
        }
        assert.equal(view.catalog.some((item) => item.model === 'qwen-max'), false);
        assert.equal(view.catalog.some((item) => item.model === 'qwen3-vl-flash'), false);
    } finally {
        restore();
        __resetRuntimeModelSettingsForTests();
    }
});

test('runtime settings reject stale writes and models removed from the live catalog', async () => {
    const restore = withDashscopeConfig();
    const store = new MemoryStore();
    __resetRuntimeModelSettingsForTests();
    try {
        await initializeRuntimeModelSettings(store);
        await assert.rejects(() => publishRuntimeModelSettings({
            primary: { provider: 'dashscope', model: 'qwen3-vl-flash' },
            fallbackChain: [],
            expectedVersion: 1
        }), (error) => error.code === 'RUNTIME_MODEL_NOT_ALLOWED');

        await assert.rejects(() => publishRuntimeModelSettings({
            primary: { provider: 'dashscope', model: 'qwen4-max' },
            fallbackChain: [],
            expectedVersion: 0
        }), (error) => error.code === 'RUNTIME_SETTINGS_VERSION_CONFLICT');
    } finally {
        restore();
        __resetRuntimeModelSettingsForTests();
    }
});

test('rollback creates a new version instead of overwriting history', async () => {
    const restore = withDashscopeConfig();
    const store = new MemoryStore();
    __resetRuntimeModelSettingsForTests();
    try {
        await initializeRuntimeModelSettings(store);
        await publishRuntimeModelSettings({
            primary: { provider: 'dashscope', model: 'qwen4-max' },
            fallbackChain: [],
            expectedVersion: 1
        }, { actorId: 'admin-1', email: 'admin@example.invalid' });
        const rolledBack = await rollbackRuntimeModelSettings({ targetVersion: 1, expectedVersion: 2 }, { actorId: 'admin-1', email: 'admin@example.invalid' });
        assert.equal(rolledBack.version, 3);
        assert.equal(rolledBack.primary.model, 'deepseek-v4.1-flash-1017');
        const history = (await getRuntimeModelSettingsView()).history;
        assert.deepEqual(history.map((item) => item.version), [3, 2, 1]);
        assert.equal(history[0].action, 'rollback');
        assert.equal(history[0].rollbackFromVersion, 1);
    } finally {
        restore();
        __resetRuntimeModelSettingsForTests();
    }
});
