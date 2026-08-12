// 外部检索 Provider 适配器。
// 默认 http-json provider：POST {query, maxResults} 到 EXTERNAL_SEARCH_ENDPOINT，
// 期望返回 { results: [{ url, title, content, publishedAt }] }（兼容 Tavily/Serper 风格）。
// 未配置时返回 not-configured 状态，绝不抛错阻断主链路。

import { getExternalRetrievalConfig } from './externalRetrievalConfig.js';

function makeAbortable (ms, parentSignal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`external search timeout ${ms}ms`)), ms);
    const cleanup = () => clearTimeout(timer);
    if (parentSignal) {
        if (parentSignal.aborted) controller.abort(parentSignal.reason);
        else parentSignal.addEventListener('abort', () => controller.abort(parentSignal.reason), { once: true });
    }
    return { signal: controller.signal, cleanup };
}

async function httpJsonSearch ({ query, maxResults, signal, timeoutMs }) {
    const cfg = getExternalRetrievalConfig();
    const { signal: innerSignal, cleanup } = makeAbortable(timeoutMs, signal);
    try {
        const response = await fetch(cfg.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {})
            },
            signal: innerSignal,
            body: JSON.stringify({ query, maxResults })
        });
        if (!response.ok) {
            return { results: [], status: 'provider-error', error: `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}` };
        }
        const payload = await response.json();
        const results = Array.isArray(payload?.results) ? payload.results : [];
        return { results, status: 'ok' };
    } catch (error) {
        const aborted = error?.name === 'AbortError' || error?.name === 'Error';
        return { results: [], status: aborted && /timeout|abort/i.test(error.message) ? 'timeout' : 'provider-error', error: error.message };
    } finally {
        cleanup();
    }
}

/**
 * 执行外部检索。未配置 provider 时返回 not-configured（不抛错）。
 * @returns {Promise<{ results: Array, status: string, error?: string }>}
 */
export async function searchExternal ({ query, maxResults, signal }) {
    const cfg = getExternalRetrievalConfig();
    if (!cfg.enabled || cfg.provider === 'none' || !cfg.endpoint) {
        return { results: [], status: 'not-configured' };
    }
    if (cfg.provider === 'http-json') {
        return httpJsonSearch({ query, maxResults, signal, timeoutMs: cfg.timeoutMs });
    }
    return { results: [], status: `unsupported-provider:${cfg.provider}` };
}
