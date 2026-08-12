import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import { generateLlmAnswer, streamLlmAnswer } from '../src/services/llmProvider.js';
import {
    __resetRuntimeModelSettingsForTests,
    initializeRuntimeModelSettings,
    publishRuntimeModelSettings
} from '../src/services/runtimeModelSettings.js';
import {
    __resetRuntimeTimeoutSettingsForTests,
    initializeRuntimeTimeoutSettings,
    publishRuntimeTimeoutSettings,
    resolveTimeoutsForModel,
    shouldFallbackOn
} from '../src/services/runtimeTimeoutSettings.js';

class MemoryStore {
    constructor () { this.data = {}; this.sequence = 0; }
    async listRecords (collection, limit = 100) { return (this.data[collection] || []).slice(0, limit); }
    async createRecord (collection, payload) {
        this.data[collection] ||= [];
        const record = { _id: String(++this.sequence), ...payload, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        this.data[collection].unshift(record);
        return record;
    }
    async updateRecord (collection, id, patch) {
        const index = (this.data[collection] || []).findIndex((item) => item._id === id);
        this.data[collection][index] = { ...this.data[collection][index], ...patch };
        return this.data[collection][index];
    }
}

function baseDefaults () {
    return { requestTimeoutMs: 60000, streamTotalTimeoutMs: 120000, firstTokenTimeoutMs: 30000, idleTimeoutMs: 15000, connectProbeMs: 15000 };
}

async function setup (timeoutOverrides = {}) {
    const original = { provider: config.llmProvider, model: config.llmModel, fallback: config.llmFallbackModels, key: config.llmApiKeys.dashscope };
    config.llmProvider = 'dashscope';
    config.llmModel = 'qwen3.5-flash-2026-02-23';
    config.llmFallbackModels = [];
    config.llmApiKeys.dashscope = 'test-secret';
    const store = new MemoryStore();
    __resetRuntimeModelSettingsForTests();
    __resetRuntimeTimeoutSettingsForTests();
    await initializeRuntimeModelSettings(store);
    await initializeRuntimeTimeoutSettings(store);
    await publishRuntimeModelSettings({
        primary: { provider: 'dashscope', model: 'qwen3.5-flash-2026-02-23' },
        fallbackChain: [{ provider: 'dashscope', model: 'qwen3.7-plus' }],
        expectedVersion: 1
    }, { actorId: 'admin' });
    await publishRuntimeTimeoutSettings({
        defaults: { ...baseDefaults(), ...(timeoutOverrides.defaults || {}) },
        perModel: timeoutOverrides.perModel || {},
        fallbackPolicy: timeoutOverrides.fallbackPolicy || { triggers: ['quota_exhausted', 'timeout', 'connect_error'], maxAttempts: 4 },
        retryPolicy: timeoutOverrides.retryPolicy || { maxRetries: 0, retryableErrors: ['timeout', 'connect_error', '5xx'], backoffBaseMs: 1, backoffMaxMs: 2 },
        expectedVersion: 1
    }, { actorId: 'admin' });
    return () => {
        config.llmProvider = original.provider;
        config.llmModel = original.model;
        config.llmFallbackModels = original.fallback;
        config.llmApiKeys.dashscope = original.key;
        __resetRuntimeModelSettingsForTests();
        __resetRuntimeTimeoutSettingsForTests();
    };
}

function hangingRequest (options) {
    return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            error.code = 'ABORT_ERR';
            reject(error);
        });
    });
}

function hangingStream (options, deltas = []) {
    const stream = new ReadableStream({
        start (controller) {
            const encoder = new TextEncoder();
            for (const delta of deltas) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`));
            }
            options.signal?.addEventListener('abort', () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                error.code = 'ABORT_ERR';
                controller.error(error);
            });
        }
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function okResponse (text) {
    return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
}

function okStream (deltas) {
    const stream = new ReadableStream({
        start (controller) {
            const encoder = new TextEncoder();
            for (const delta of deltas) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`));
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
        }
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

test('non-stream request timeout triggers fallback to next model', async () => {
    const restore = await setup();
    const originalFetch = global.fetch;
    const requestedModels = [];
    global.fetch = async (_url, options) => {
        requestedModels.push(JSON.parse(options.body).model);
        if (requestedModels.length === 1) return hangingRequest(options);
        return okResponse('fallback ok');
    };
    try {
        const result = await generateLlmAnswer({ systemPrompt: 's', prompt: 'p', modelConfig: { timeoutMs: 30 } });
        assert.equal(result.text, 'fallback ok');
        assert.equal(result.provider.fallbackUsed, true);
        assert.deepEqual(requestedModels, ['qwen3.5-flash-2026-02-23', 'qwen3.7-plus']);
    } finally { global.fetch = originalFetch; restore(); }
});

test('first-token timeout before any delta triggers stream fallback', async () => {
    const restore = await setup();
    const originalFetch = global.fetch;
    const requestedModels = [];
    global.fetch = async (_url, options) => {
        requestedModels.push(JSON.parse(options.body).model);
        if (requestedModels.length === 1) return hangingStream(options, []);
        return okStream(['OK']);
    };
    let streamed = '';
    try {
        const result = await streamLlmAnswer({ systemPrompt: 's', prompt: 'p', onDelta: (d) => { streamed += d; }, modelConfig: { firstTokenTimeoutMs: 30, streamTimeoutMs: 5000 } });
        assert.equal(streamed, 'OK');
        assert.equal(result.provider.fallbackUsed, true);
        assert.deepEqual(requestedModels, ['qwen3.5-flash-2026-02-23', 'qwen3.7-plus']);
    } finally { global.fetch = originalFetch; restore(); }
});

test('mid-stream idle timeout after partial output does NOT fallback', async () => {
    const restore = await setup();
    const originalFetch = global.fetch;
    let callCount = 0;
    global.fetch = async (_url, options) => {
        callCount += 1;
        return hangingStream(options, ['PARTIAL']);
    };
    let streamed = '';
    try {
        await assert.rejects(
            () => streamLlmAnswer({ systemPrompt: 's', prompt: 'p', onDelta: (d) => { streamed += d; }, modelConfig: { idleTimeoutMs: 30, firstTokenTimeoutMs: 5000, streamTimeoutMs: 5000 } }),
            (error) => error.timeoutType === 'idle'
        );
        assert.equal(streamed, 'PARTIAL');
        assert.equal(callCount, 1);
    } finally { global.fetch = originalFetch; restore(); }
});

test('per-model override resolves idle/total independently', async () => {
    const restore = await setup({ perModel: { 'qwen3.7-plus': { idleTimeoutMs: 30000, streamTotalTimeoutMs: 240000 } } });
    try {
        const t = resolveTimeoutsForModel('qwen3.7-plus');
        assert.equal(t.idleTimeoutMs, 30000);
        assert.equal(t.streamTotalTimeoutMs, 240000);
        assert.equal(t.firstTokenTimeoutMs, 30000);
        assert.equal(shouldFallbackOn('timeout'), true);
    } finally { restore(); }
});

test('same-model retry on timeout with backoff before fallback', async () => {
    const restore = await setup({ retryPolicy: { maxRetries: 1, retryableErrors: ['timeout'], backoffBaseMs: 1, backoffMaxMs: 2 } });
    const originalFetch = global.fetch;
    const requestedModels = [];
    global.fetch = async (_url, options) => {
        requestedModels.push(JSON.parse(options.body).model);
        if (requestedModels.length <= 2) return hangingRequest(options);
        return okResponse('fallback after retry');
    };
    try {
        const result = await generateLlmAnswer({ systemPrompt: 's', prompt: 'p', modelConfig: { timeoutMs: 30 } });
        assert.equal(result.text, 'fallback after retry');
        assert.deepEqual(requestedModels, ['qwen3.5-flash-2026-02-23', 'qwen3.5-flash-2026-02-23', 'qwen3.7-plus']);
    } finally { global.fetch = originalFetch; restore(); }
});
