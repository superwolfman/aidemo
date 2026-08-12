import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import { generateLlmAnswer, streamLlmAnswer } from '../src/services/llmProvider.js';
import {
    __resetRuntimeModelSettingsForTests,
    initializeRuntimeModelSettings,
    publishRuntimeModelSettings
} from '../src/services/runtimeModelSettings.js';

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
        const index = this.data[collection].findIndex((item) => item._id === id);
        this.data[collection][index] = { ...this.data[collection][index], ...patch };
        return this.data[collection][index];
    }
}

async function setupRouting () {
    const original = {
        provider: config.llmProvider,
        model: config.llmModel,
        fallback: config.llmFallbackModels,
        key: config.llmApiKeys.dashscope
    };
    config.llmProvider = 'dashscope';
    config.llmModel = 'qwen3.5-flash-2026-02-23';
    config.llmFallbackModels = [];
    config.llmApiKeys.dashscope = 'test-secret';
    const store = new MemoryStore();
    __resetRuntimeModelSettingsForTests();
    await initializeRuntimeModelSettings(store);
    await publishRuntimeModelSettings({
        primary: { provider: 'dashscope', model: 'qwen3.5-flash-2026-02-23' },
        fallbackChain: [{ provider: 'dashscope', model: 'qwen3.7-plus' }],
        expectedVersion: 1
    }, { actorId: 'admin' });
    return () => {
        config.llmProvider = original.provider;
        config.llmModel = original.model;
        config.llmFallbackModels = original.fallback;
        config.llmApiKeys.dashscope = original.key;
        __resetRuntimeModelSettingsForTests();
    };
}

function quotaResponse () {
    return new Response(JSON.stringify({ error: { code: 'AllocationQuota.FreeTierOnly', message: 'Free quota exhausted.' } }), { status: 403 });
}

test('non-streaming calls switch to the next model only for explicit quota exhaustion', async () => {
    const restore = await setupRouting();
    const originalFetch = global.fetch;
    const requestedModels = [];
    global.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        requestedModels.push(body.model);
        if (requestedModels.length === 1) return quotaResponse();
        return new Response(JSON.stringify({ choices: [{ message: { content: 'fallback success' } }] }), { status: 200 });
    };
    try {
        const result = await generateLlmAnswer({ systemPrompt: 'system', prompt: 'prompt' });
        assert.equal(result.text, 'fallback success');
        assert.equal(result.provider.fallbackUsed, true);
        assert.deepEqual(requestedModels, ['qwen3.5-flash-2026-02-23', 'qwen3.7-plus']);
    } finally { global.fetch = originalFetch; restore(); }
});

test('authentication failures never trigger fallback models', async () => {
    const restore = await setupRouting();
    const originalFetch = global.fetch;
    let count = 0;
    global.fetch = async () => {
        count += 1;
        return new Response(JSON.stringify({ error: { code: 'InvalidApiKey', message: 'invalid key' } }), { status: 401 });
    };
    try {
        await assert.rejects(() => generateLlmAnswer({ systemPrompt: 'system', prompt: 'prompt' }), (error) => error.code === 'LLM_PROVIDER_ERROR');
        assert.equal(count, 1);
    } finally { global.fetch = originalFetch; restore(); }
});

test('streaming calls switch before the first token when quota is exhausted', async () => {
    const restore = await setupRouting();
    const originalFetch = global.fetch;
    const requestedModels = [];
    global.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        requestedModels.push(body.model);
        if (requestedModels.length === 1) return quotaResponse();
        return new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n', {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' }
        });
    };
    let streamed = '';
    try {
        const result = await streamLlmAnswer({ systemPrompt: 'system', prompt: 'prompt', onDelta: (delta) => { streamed += delta; } });
        assert.equal(streamed, 'OK');
        assert.equal(result.provider.fallbackUsed, true);
        assert.deepEqual(requestedModels, ['qwen3.5-flash-2026-02-23', 'qwen3.7-plus']);
    } finally { global.fetch = originalFetch; restore(); }
});
