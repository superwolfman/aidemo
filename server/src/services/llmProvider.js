import { config } from '../config.js';
import { sleep } from '../utils/sse.js';
import {
    getRuntimeModelCatalog,
    getRuntimeModelSettingsSnapshot
} from './runtimeModelSettings.js';
import {
    getRuntimeTimeoutSettingsSnapshot,
    resolveTimeoutsForModel,
    shouldFallbackOn
} from './runtimeTimeoutSettings.js';
import { recordLlmTiming } from './llmTimingMetrics.js';

const providerDefaults = {
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
    deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    dashscope: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    'openai-compatible': { baseUrl: '', model: '' }
};

const QUOTA_EXHAUSTED_CODES = new Set([
    'AllocationQuota.FreeTierOnly',
    'AllocationQuota.Exceeded',
    'QuotaExhausted',
    'quota_exhausted',
    'insufficient_quota'
]);

// 运行时超时策略热更新入口：优先读 runtime_settings 快照，
// env 仅作为未初始化时的种子和 LLM_TIMEOUT_FORCE=true 时的紧急覆盖。
function effectiveTimeouts (model) {
    return resolveTimeoutsForModel(model);
}

export class LlmProviderError extends Error {
    constructor (message, { statusCode, providerCode, detail, quotaExhausted = false } = {}) {
        super(message);
        this.name = 'LlmProviderError';
        this.statusCode = statusCode;
        this.providerCode = providerCode;
        this.detail = detail;
        this.quotaExhausted = quotaExhausted;
        this.code = quotaExhausted ? 'LLM_QUOTA_EXHAUSTED' : 'LLM_PROVIDER_ERROR';
    }
}

function normalizeBaseUrl (baseUrl) {
    return String(baseUrl || '').replace(/\/$/, '');
}

function makeTimeoutController (ms, parentSignal, type = 'total') {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error(`LLM ${type} timeout after ${ms}ms`));
    }, ms);
    const cleanup = () => clearTimeout(timer);
    if (parentSignal) {
        const onParentAbort = () => {
            cleanup();
            controller.abort(parentSignal.reason || new Error('LLM request cancelled by caller'));
        };
        if (parentSignal.aborted) onParentAbort();
        else parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
    return {
        signal: controller.signal,
        cleanup,
        abort: (reason) => controller.abort(reason),
        didTimeout: () => timedOut
    };
}

const NETWORK_ERROR_CODES = new Set([
    'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED',
    'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'
]);

function isAbortError (error) {
    return Boolean(error) && (error.name === 'AbortError' || error.code === 'ABORT_ERR' || error.code === 20);
}

/**
 * 将异常归类为 fallback 触发原因，供降级决策使用。
 * 返回 'quota_exhausted' | 'timeout' | 'connect_error' | '5xx' | null。
 */
function classifyForFallback (error) {
    if (error instanceof LlmProviderError) {
        if (error.quotaExhausted) return 'quota_exhausted';
        if (error.timeoutType === 'connect_error') return 'connect_error';
        if (error.timeoutType) return 'timeout';
        if (typeof error.statusCode === 'number' && error.statusCode >= 500) return '5xx';
        return null;
    }
    if (isAbortError(error)) return 'timeout';
    if (typeof error?.code === 'string' && NETWORK_ERROR_CODES.has(error.code)) return 'connect_error';
    return null;
}

function buildTimeoutError (type, ms) {
    const label = { first_token: '首字', idle: '空闲', total: '总', request: '总', connect: '连接' }[type] || type;
    const error = new LlmProviderError(`LLM ${label}超时 (${ms}ms)`, {
        statusCode: 408,
        providerCode: 'LLM_TIMEOUT',
        detail: `timeout_type=${type}`
    });
    error.timeoutType = type;
    return error;
}

function retryDelayMs (attempt, base, max) {
    const exp = Math.min(base * (2 ** attempt), max);
    return exp + Math.floor(Math.random() * 200);
}

function retryPolicy () {
    return getRuntimeTimeoutSettingsSnapshot().retryPolicy || { maxRetries: 0, retryableErrors: [], backoffBaseMs: 800, backoffMaxMs: 4000 };
}

function providerKey (provider) {
    return config.llmApiKeys?.[provider] || '';
}

function hasExplicitModelOverride (override = {}) {
    return Boolean(override.provider || override.model || override.baseUrl);
}

function runtimeCandidates (override = {}) {
    if (hasExplicitModelOverride(override)) return [override];
    const settings = getRuntimeModelSettingsSnapshot();
    return [settings.primary, ...(settings.fallbackChain || [])].filter((item) => item?.provider && item?.model);
}

function resolveProvider (override = {}) {
    const runtimePrimary = getRuntimeModelSettingsSnapshot().primary || {};
    const provider = override.provider || runtimePrimary.provider || config.llmProvider;
    const defaults = providerDefaults[provider] || providerDefaults['openai-compatible'];
    const configuredBaseUrl = provider === config.llmProvider ? config.llmBaseUrl : '';
    const baseUrl = normalizeBaseUrl(override.baseUrl || configuredBaseUrl || defaults.baseUrl);
    const model = override.model || runtimePrimary.model || config.llmModel || defaults.model;
    const apiKey = providerKey(provider);
    const configured = provider !== 'mock' && Boolean(apiKey && baseUrl && model);
    return {
        provider,
        mode: configured ? 'live' : 'fallback',
        baseUrl: configured ? baseUrl.replace(/\/v1\/?$/, '/v1') : '',
        model: configured ? model : 'deterministic-local-runtime',
        requestedModel: model,
        configured,
        apiKey,
        protocol: configured ? 'openai-compatible-chat-completions' : 'local-deterministic',
        streaming: configured
    };
}

function publicStatus (resolved, routing = {}) {
    return {
        provider: resolved.provider,
        mode: resolved.mode,
        baseUrl: resolved.baseUrl,
        model: resolved.model,
        requestedModel: resolved.requestedModel,
        configured: resolved.configured,
        protocol: resolved.protocol,
        streaming: resolved.streaming,
        runtimeVersion: getRuntimeModelSettingsSnapshot().version,
        fallbackUsed: Boolean(routing.fallbackUsed),
        primaryModel: routing.primaryModel || resolved.requestedModel,
        attemptedModels: routing.attemptedModels || [resolved.requestedModel]
    };
}

function buildMessages ({ systemPrompt, prompt, sources, toolResults }) {
    const safeSources = Array.isArray(sources) ? sources : [];
    const safeToolResults = toolResults && typeof toolResults === 'object' ? toolResults : {};
    const context = safeSources
        .map((source, index) => `[${index + 1}] ${source.documentTitle || source.title || 'unknown'}: ${source.content || ''}`)
        .join('\n');
    return [
        {
            role: 'system',
            content: `${systemPrompt}\n你必须基于引用资料、工具结果和用户输入回答。输出 Markdown，明确列出架构判断、风险、下一步和引用来源。若引用资料不足，需要明确说明缺口，不能编造来源。`
        },
        {
            role: 'user',
            content: `用户请求:\n${prompt}\n\nRAG 引用:\n${context || '无'}\n\n工具结果:\n${JSON.stringify(safeToolResults, null, 2)}`
        }
    ];
}

function requestBody (resolved, input, stream = false) {
    return {
        model: resolved.requestedModel,
        temperature: 0.2,
        ...(stream ? { stream: true } : {}),
        ...(resolved.provider === 'dashscope' ? { enable_thinking: false } : {}),
        messages: buildMessages(input)
    };
}

function parseProviderFailure (statusCode, detail, operation) {
    let payload = null;
    try { payload = JSON.parse(detail); } catch { /* provider may return plain text */ }
    const providerCode = payload?.error?.code || payload?.code || '';
    const providerMessage = payload?.error?.message || payload?.message || detail;
    const quotaExhausted = QUOTA_EXHAUSTED_CODES.has(providerCode) ||
        /free quota exhausted|quota[_\s-]?exhausted|allocation quota.*exceed/i.test(String(providerMessage));
    return new LlmProviderError(
        `${operation}: ${statusCode} ${String(providerMessage).slice(0, 240)}`,
        { statusCode, providerCode, detail: String(providerMessage).slice(0, 500), quotaExhausted }
    );
}

function routingStatus (resolved, candidates, attemptedModels, index) {
    return publicStatus(resolved, {
        fallbackUsed: index > 0,
        primaryModel: candidates[0]?.model,
        attemptedModels
    });
}

export function getProviderStatus (override = {}) {
    const candidates = runtimeCandidates(override);
    const resolved = resolveProvider(candidates[0] || override);
    const status = publicStatus(resolved);
    return {
        ...status,
        fallbackChain: hasExplicitModelOverride(override)
            ? []
            : candidates.slice(1).map((item) => ({ provider: item.provider, model: item.model }))
    };
}

export function getModelPresets () {
    const active = getRuntimeModelSettingsSnapshot().primary;
    return getRuntimeModelCatalog().map((preset) => ({
        ...preset,
        configured: preset.credentialConfigured,
        active: preset.provider === active.provider && preset.model === active.model
    }));
}

async function generateOnce ({ candidate, systemPrompt, prompt, sources, toolResults, modelConfig }) {
    const resolved = resolveProvider(candidate);
    if (!resolved.configured) return { resolved, text: '' };
    const timeouts = effectiveTimeouts(resolved.requestedModel);
    const ms = modelConfig.timeoutMs || timeouts.requestTimeoutMs;
    const userCancelled = () => Boolean(modelConfig.signal?.aborted);
    const { signal, cleanup, didTimeout } = makeTimeoutController(ms, modelConfig.signal, 'request');
    const startedAt = Date.now();
    try {
        const response = await fetch(`${normalizeBaseUrl(resolved.baseUrl)}/chat/completions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${resolved.apiKey}`, 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify(requestBody(resolved, { systemPrompt, prompt, sources, toolResults }))
        });
        if (!response.ok) throw parseProviderFailure(response.status, await response.text(), 'LLM provider failed');
        const payload = await response.json();
        const totalMs = Date.now() - startedAt;
        recordLlmTiming({ model: resolved.requestedModel, ttftMs: totalMs, totalMs, timedOut: false });
        return { resolved, text: payload?.choices?.[0]?.message?.content || '' };
    } catch (error) {
        const timedOut = isAbortError(error) && didTimeout() && !userCancelled();
        if (timedOut) {
            const timeoutError = buildTimeoutError('request', ms);
            recordLlmTiming({ model: resolved.requestedModel, ttftMs: Date.now() - startedAt, totalMs: Date.now() - startedAt, timedOut: true, timeoutType: 'request' });
            throw timeoutError;
        }
        throw error;
    } finally {
        cleanup();
    }
}

export async function generateLlmAnswer ({ systemPrompt, prompt, sources = [], toolResults = {}, fallback = '', modelConfig = {} }) {
    const candidates = runtimeCandidates(modelConfig);
    const attemptedModels = [];
    const policy = retryPolicy();
    for (let index = 0; index < candidates.length; index += 1) {
        const candidate = { ...candidates[index], ...modelConfig };
        attemptedModels.push(candidate.model);
        let attempt = 0;
        // 同模型有限重试（仅对可重试错误：timeout/connect_error/5xx），指数退避 + 抖动
        while (true) {
            try {
                const { resolved, text } = await generateOnce({ candidate, systemPrompt, prompt, sources, toolResults, modelConfig });
                return { provider: routingStatus(resolved, candidates, attemptedModels, index), text: String(text).trim() || fallback };
            } catch (error) {
                const reason = classifyForFallback(error);
                const retryable = reason && policy.retryableErrors.includes(reason) && attempt < policy.maxRetries;
                if (retryable) {
                    attempt += 1;
                    await sleep(retryDelayMs(attempt - 1, policy.backoffBaseMs, policy.backoffMaxMs));
                    continue;
                }
                const canFallback = reason && shouldFallbackOn(reason) && index < candidates.length - 1;
                if (canFallback) break; // 切换到下一个候选模型
                throw error;
            }
        }
    }
    const resolved = resolveProvider(candidates[0] || modelConfig);
    return { provider: publicStatus(resolved), text: fallback };
}

async function streamOnce ({ candidate, systemPrompt, prompt, sources, toolResults, onDelta, modelConfig }) {
    const resolved = resolveProvider(candidate);
    if (!resolved.configured) return { resolved, streamed: false, text: '' };
    const timeouts = effectiveTimeouts(resolved.requestedModel);
    const totalTimeoutMs = modelConfig.streamTimeoutMs || timeouts.streamTotalTimeoutMs;
    const firstTokenMs = modelConfig.firstTokenTimeoutMs || timeouts.firstTokenTimeoutMs;
    const idleMs = modelConfig.idleTimeoutMs || timeouts.idleTimeoutMs;
    const userCancelled = () => Boolean(modelConfig.signal?.aborted);
    const { signal, cleanup, abort, didTimeout } = makeTimeoutController(totalTimeoutMs, modelConfig.signal, 'total');
    let abortType = null;
    let firstTokenTimer = setTimeout(() => { abortType = 'first_token'; abort(new Error(`LLM first token timeout after ${firstTokenMs}ms`)); }, firstTokenMs);
    let idleTimer = null;
    const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => { abortType = 'idle'; abort(new Error(`LLM idle timeout after ${idleMs}ms`)); }, idleMs);
    };
    const clearFirstTokenTimer = () => {
        if (firstTokenTimer) clearTimeout(firstTokenTimer);
        firstTokenTimer = null;
    };
    let emitted = false;
    let firstTokenAt = 0;
    const startedAt = Date.now();
    try {
        const response = await fetch(`${normalizeBaseUrl(resolved.baseUrl)}/chat/completions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${resolved.apiKey}`, 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify(requestBody(resolved, { systemPrompt, prompt, sources, toolResults }, true))
        });
        if (!response.ok || !response.body) throw parseProviderFailure(response.status, await response.text(), 'LLM provider stream failed');
        resetIdle();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let text = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            resetIdle();
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split('\n\n');
            buffer = frames.pop() || '';
            for (const frame of frames) {
                for (const line of frame.split('\n').map((item) => item.trim()).filter(Boolean)) {
                    if (!line.startsWith('data:')) continue;
                    const raw = line.replace(/^data:\s*/, '');
                    if (raw === '[DONE]') {
                        recordLlmTiming({ model: resolved.requestedModel, ttftMs: firstTokenAt ? firstTokenAt - startedAt : Date.now() - startedAt, totalMs: Date.now() - startedAt, timedOut: false });
                        return { resolved, streamed: true, text };
                    }
                    const delta = JSON.parse(raw)?.choices?.[0]?.delta?.content || '';
                    if (delta) {
                        clearFirstTokenTimer();
                        if (!emitted) firstTokenAt = Date.now();
                        emitted = true;
                        text += delta;
                        await onDelta?.(delta);
                    }
                }
            }
        }
        recordLlmTiming({ model: resolved.requestedModel, ttftMs: firstTokenAt ? firstTokenAt - startedAt : Date.now() - startedAt, totalMs: Date.now() - startedAt, timedOut: false });
        return { resolved, streamed: true, text };
    } catch (error) {
        if (isAbortError(error) && (didTimeout() || abortType) && !userCancelled()) {
            const type = abortType || 'total';
            const timeoutError = buildTimeoutError(type, type === 'first_token' ? firstTokenMs : (type === 'idle' ? idleMs : totalTimeoutMs));
            recordLlmTiming({ model: resolved.requestedModel, ttftMs: firstTokenAt ? firstTokenAt - startedAt : Date.now() - startedAt, totalMs: Date.now() - startedAt, timedOut: true, timeoutType: type });
            // 已向客户端推送过 delta 的中途超时不能安全切 fallback，直接抛出。
            if (emitted && type !== 'first_token') timeoutError.partialStreamEmitted = true;
            throw timeoutError;
        }
        throw error;
    } finally {
        clearFirstTokenTimer();
        if (idleTimer) clearTimeout(idleTimer);
        cleanup();
    }
}

export async function streamLlmAnswer ({ systemPrompt, prompt, sources = [], toolResults = {}, onDelta, modelConfig = {} }) {
    const candidates = runtimeCandidates(modelConfig);
    const attemptedModels = [];
    for (let index = 0; index < candidates.length; index += 1) {
        const candidate = { ...candidates[index], ...modelConfig };
        attemptedModels.push(candidate.model);
        try {
            const result = await streamOnce({ candidate, systemPrompt, prompt, sources, toolResults, onDelta, modelConfig });
            return { provider: routingStatus(result.resolved, candidates, attemptedModels, index), streamed: result.streamed, text: result.text };
        } catch (error) {
            // 已推送过 delta 的中途超时不能安全切 fallback（会导致重复输出），直接抛出
            if (error?.partialStreamEmitted) throw error;
            const reason = classifyForFallback(error);
            const canFallback = reason && shouldFallbackOn(reason) && index < candidates.length - 1;
            if (canFallback) continue;
            throw error;
        }
    }
    const resolved = resolveProvider(candidates[0] || modelConfig);
    return { provider: publicStatus(resolved), streamed: false, text: '' };
}

export async function testLlmConnection ({ provider, model, timeoutMs = 15000 }) {
    const startedAt = Date.now();
    const result = await generateLlmAnswer({
        systemPrompt: 'You are a connectivity probe. Reply with OK only.',
        prompt: 'OK',
        fallback: '',
        modelConfig: { provider, model, timeoutMs }
    });
    return {
        ok: Boolean(result.provider.configured && result.text),
        provider: result.provider.provider,
        model: result.provider.requestedModel,
        latencyMs: Date.now() - startedAt,
        credentialSource: 'server-secret'
    };
}
