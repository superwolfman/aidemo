import assert from 'node:assert/strict';
import test from 'node:test';
import {
    __resetRuntimeTimeoutSettingsForTests,
    getRuntimeTimeoutSettingsSnapshot,
    getRuntimeTimeoutSettingsView,
    initializeRuntimeTimeoutSettings,
    publishRuntimeTimeoutSettings,
    resolveTimeoutsForModel,
    rollbackRuntimeTimeoutSettings,
    shouldFallbackOn
} from '../src/services/runtimeTimeoutSettings.js';

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

function baseDefaults () {
    return {
        requestTimeoutMs: 60000,
        streamTotalTimeoutMs: 120000,
        firstTokenTimeoutMs: 30000,
        idleTimeoutMs: 15000,
        connectProbeMs: 15000
    };
}

test('timeout settings initialize from env defaults and become active immediately', async () => {
    const store = new MemoryStore();
    __resetRuntimeTimeoutSettingsForTests();
    try {
        const initial = await initializeRuntimeTimeoutSettings(store);
        assert.equal(initial.version, 1);
        assert.deepEqual(initial.defaults, baseDefaults());
        assert.equal(initial.fallbackPolicy.triggers.includes('timeout'), true);
        assert.equal(shouldFallbackOn('timeout'), true);
        assert.equal(shouldFallbackOn('quota_exhausted'), true);
        assert.deepEqual(resolveTimeoutsForModel('qwen-plus'), baseDefaults());
    } finally {
        __resetRuntimeTimeoutSettingsForTests();
    }
});

test('published timeout settings hot-replace snapshot and preserve history', async () => {
    const store = new MemoryStore();
    __resetRuntimeTimeoutSettingsForTests();
    try {
        await initializeRuntimeTimeoutSettings(store);
        const published = await publishRuntimeTimeoutSettings({
            defaults: { ...baseDefaults(), streamTotalTimeoutMs: 150000 },
            perModel: { 'deepseek-reasoner': { streamTotalTimeoutMs: 240000, firstTokenTimeoutMs: 60000 } },
            fallbackPolicy: { triggers: ['quota_exhausted', 'timeout'], maxAttempts: 4 },
            retryPolicy: { maxRetries: 1, retryableErrors: ['timeout'], backoffBaseMs: 800, backoffMaxMs: 4000 },
            expectedVersion: 1,
            changeNote: 'reasoner 调到 240s'
        }, { actorId: 'admin-1', email: 'admin@example.invalid' });

        assert.equal(published.version, 2);
        const snap = getRuntimeTimeoutSettingsSnapshot();
        assert.equal(snap.defaults.streamTotalTimeoutMs, 150000);
        assert.equal(snap.perModel['deepseek-reasoner'].streamTotalTimeoutMs, 240000);
        assert.deepEqual(resolveTimeoutsForModel('deepseek-reasoner'), {
            ...baseDefaults(),
            streamTotalTimeoutMs: 240000,
            firstTokenTimeoutMs: 60000
        });
        // 未覆盖的模型走默认
        assert.equal(resolveTimeoutsForModel('qwen-plus').streamTotalTimeoutMs, 150000);
        const view = await getRuntimeTimeoutSettingsView();
        assert.equal(view.history[0].version, 2);
        assert.equal(view.history[0].changedBy.email, 'admin@example.invalid');
        assert.equal(view.history[0].changeNote, 'reasoner 调到 240s');
    } finally {
        __resetRuntimeTimeoutSettingsForTests();
    }
});

test('timeout settings reject out-of-range values and stale versions', async () => {
    const store = new MemoryStore();
    __resetRuntimeTimeoutSettingsForTests();
    try {
        await initializeRuntimeTimeoutSettings(store);
        await assert.rejects(() => publishRuntimeTimeoutSettings({
            defaults: { ...baseDefaults(), firstTokenTimeoutMs: 100 },
            expectedVersion: 1
        }), (error) => error.code === 'RUNTIME_TIMEOUT_OUT_OF_RANGE');

        await assert.rejects(() => publishRuntimeTimeoutSettings({
            defaults: baseDefaults(),
            expectedVersion: 0
        }), (error) => error.code === 'RUNTIME_SETTINGS_VERSION_CONFLICT');

        await assert.rejects(() => publishRuntimeTimeoutSettings({
            defaults: baseDefaults(),
            fallbackPolicy: { triggers: ['unknown_trigger'] },
            expectedVersion: 1
        }), (error) => error.code === 'RUNTIME_TIMEOUT_INVALID');
    } finally {
        __resetRuntimeTimeoutSettingsForTests();
    }
});

test('rollback creates a new version instead of overwriting history', async () => {
    const store = new MemoryStore();
    __resetRuntimeTimeoutSettingsForTests();
    try {
        await initializeRuntimeTimeoutSettings(store);
        await publishRuntimeTimeoutSettings({
            defaults: { ...baseDefaults(), streamTotalTimeoutMs: 150000 },
            expectedVersion: 1
        }, { actorId: 'admin-1', email: 'admin@example.invalid' });
        const rolledBack = await rollbackRuntimeTimeoutSettings({ targetVersion: 1, expectedVersion: 2 }, { actorId: 'admin-1', email: 'admin@example.invalid' });
        assert.equal(rolledBack.version, 3);
        assert.equal(rolledBack.defaults.streamTotalTimeoutMs, 120000);
        const history = (await getRuntimeTimeoutSettingsView()).history;
        assert.deepEqual(history.map((item) => item.version), [3, 2, 1]);
        assert.equal(history[0].action, 'rollback');
        assert.equal(history[0].rollbackFromVersion, 1);
    } finally {
        __resetRuntimeTimeoutSettingsForTests();
    }
});
