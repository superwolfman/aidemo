// 外部检索 Provider 适配器。
// 默认 http-json provider：POST {query, maxResults} 到 EXTERNAL_SEARCH_ENDPOINT，
// 期望返回 { results: [{ url, title, content, publishedAt }] }（兼容 Tavily/Serper 风格）。
// 未配置时返回 not-configured 状态，绝不抛错阻断主链路。

import { getExternalRetrievalConfig } from './externalRetrievalConfig.js';

const circuit = { failures: 0, openedAt: 0 };
let activeRequests = 0;

function makeAbortable (ms, parentSignal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`external search timeout ${ms}ms`)), ms);
    const onParentAbort = () => controller.abort(parentSignal?.reason);
    const cleanup = () => {
        clearTimeout(timer);
        parentSignal?.removeEventListener?.('abort', onParentAbort);
    };
    if (parentSignal) {
        if (parentSignal.aborted) controller.abort(parentSignal.reason);
        else parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
    return { signal: controller.signal, cleanup };
}

async function readLimitedJson (response, maxBytes) {
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new Error('external search response exceeds size limit');
    if (!response.body?.getReader) return response.json();
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            throw new Error('external search response exceeds size limit');
        }
        chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(merged));
}

function buildProviderRequest (cfg, query, maxResults) {
    if (cfg.provider === 'tavily') {
        return {
            headers: { 'Content-Type': 'application/json' },
            body: { api_key: cfg.apiKey, query, max_results: maxResults, include_answer: false, include_raw_content: 'markdown' }
        };
    }
    if (cfg.provider === 'serper') {
        return {
            headers: { 'Content-Type': 'application/json', 'X-API-KEY': cfg.apiKey },
            body: { q: query, num: maxResults }
        };
    }
    return {
        headers: {
            'Content-Type': 'application/json',
            ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {})
        },
        body: { query, maxResults }
    };
}

function normalizeResults (cfg, payload) {
    const rows = cfg.provider === 'serper' ? payload?.organic : payload?.results;
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, cfg.maxResults).map((item) => ({
        url: item?.url || item?.link || '',
        title: item?.title || '',
        content: item?.raw_content || item?.content || item?.snippet || '',
        contentOrigin: item?.raw_content ? 'fetched-page' : 'provider-snippet',
        publishedAt: item?.publishedAt || item?.published_date || item?.date || null,
        providerScore: Number.isFinite(Number(item?.score)) ? Number(item.score) : null
    }));
}

async function httpJsonSearch ({ query, maxResults, signal, timeoutMs }) {
    const cfg = getExternalRetrievalConfig();
    if (activeRequests >= cfg.maxConcurrentRequests) return { results: [], status: 'rate-limited', error: 'external search concurrency limit reached' };
    if (circuit.openedAt && Date.now() - circuit.openedAt < cfg.circuitOpenMs) return { results: [], status: 'circuit-open', error: 'external search circuit breaker is open' };
    if (circuit.openedAt) Object.assign(circuit, { failures: 0, openedAt: 0 });
    const { signal: innerSignal, cleanup } = makeAbortable(timeoutMs, signal);
    const request = buildProviderRequest(cfg, query, maxResults);
    activeRequests += 1;
    try {
        const response = await fetch(cfg.endpoint, {
            method: 'POST',
            headers: request.headers,
            signal: innerSignal,
            body: JSON.stringify(request.body)
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
        }
        const payload = await readLimitedJson(response, cfg.maxResponseBytes);
        Object.assign(circuit, { failures: 0, openedAt: 0 });
        return { results: normalizeResults(cfg, payload), status: 'ok' };
    } catch (error) {
        const aborted = error?.name === 'AbortError' || error?.name === 'Error';
        circuit.failures += 1;
        if (circuit.failures >= cfg.circuitFailureThreshold) circuit.openedAt = Date.now();
        return { results: [], status: aborted && /timeout|abort/i.test(error.message) ? 'timeout' : 'provider-error', error: error.message };
    } finally {
        activeRequests = Math.max(0, activeRequests - 1);
        cleanup();
    }
}

/**
 * 执行外部检索。未配置 provider 时返回 not-configured（不抛错）。
 * @returns {Promise<{ results: Array, status: string, error?: string }>}
 */
export async function searchExternal ({ query, maxResults, signal }) {
    const cfg = getExternalRetrievalConfig();
    if (!cfg.enabled) return { results: [], status: 'disabled' };
    if (!cfg.configured) {
        return { results: [], status: 'not-configured' };
    }
    if (['http-json', 'tavily', 'serper'].includes(cfg.provider)) {
        return httpJsonSearch({ query, maxResults, signal, timeoutMs: cfg.timeoutMs });
    }
    return { results: [], status: `unsupported-provider:${cfg.provider}` };
}
