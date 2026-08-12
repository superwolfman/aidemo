// 进程内 LLM 调用耗时指标采集器（环形缓冲，每模型最多 SAMPLE_LIMIT 条）。
// 可选注入 telemetry sink 实现持久化与多实例可查；内存缓冲仍用于快速 P95 建议。
import { getRuntimeTimeoutSettingsSnapshot } from './runtimeTimeoutSettings.js';

const SAMPLE_LIMIT = 100;
const MIN_SAMPLES_FOR_SUGGESTION = 5; // 自适应建议的最小成功样本门槛
const buckets = new Map(); // model -> { samples: [...] }
let telemetrySink = null; // 持久化 sink（store.createTelemetry），可选

function bucket (model) {
    const key = String(model || 'unknown');
    let entry = buckets.get(key);
    if (!entry) {
        entry = { samples: [] };
        buckets.set(key, entry);
    }
    return entry;
}

/**
 * 注入持久化 sink（如 store.createTelemetry）。注入后每次采样会 fire-and-forget
 * 写一条 telemetry，使指标可跨实例查询、重启不丢。未注入则仅内存。
 */
export function setLlmTimingTelemetrySink (sink) {
    telemetrySink = typeof sink === 'function' ? sink : null;
}

export function recordLlmTiming ({ model, ttftMs, totalMs, timedOut, timeoutType, fallbackTriggered, provider, stream }) {
    const entry = bucket(model);
    const sample = {
        ttftMs: Number(ttftMs) || 0,
        totalMs: Number(totalMs) || 0,
        timedOut: Boolean(timedOut),
        timeoutType: timeoutType || null,
        fallbackTriggered: Boolean(fallbackTriggered),
        provider: provider || null,
        stream: Boolean(stream),
        configVersion: getRuntimeTimeoutSettingsSnapshot().version,
        at: Date.now()
    };
    entry.samples.push(sample);
    if (entry.samples.length > SAMPLE_LIMIT) entry.samples.shift(); // 超时计数随样本同步淘汰，不存在失真

    if (telemetrySink) {
        try {
            telemetrySink({
                type: 'llm.request.timing',
                model: String(model || 'unknown'),
                ttftMs: sample.ttftMs,
                totalMs: sample.totalMs,
                timedOut: sample.timedOut,
                timeoutType: sample.timeoutType,
                fallbackTriggered: sample.fallbackTriggered,
                provider: sample.provider,
                stream: sample.stream,
                configVersion: sample.configVersion
            });
        } catch { /* 持久化失败不影响主流程 */ }
    }
}

function percentile (sorted, p) {
    if (!sorted.length) return null;
    const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
    return sorted[index];
}

export function getLlmTimingStats () {
    const result = {};
    for (const [model, entry] of buckets.entries()) {
        const samples = entry.samples;
        const successful = samples.filter((item) => !item.timedOut);
        const ttftSorted = successful.map((item) => item.ttftMs).filter(Boolean).sort((a, b) => a - b);
        const totalSorted = successful.map((item) => item.totalMs).filter(Boolean).sort((a, b) => a - b);
        const timeoutCount = samples.filter((item) => item.timedOut).length; // 实时从样本计算，不会超 100%
        result[model] = {
            count: samples.length,
            successCount: successful.length,
            timeoutCount,
            timeoutRate: samples.length ? timeoutCount / samples.length : 0,
            fallbackTriggeredCount: samples.filter((item) => item.fallbackTriggered).length,
            ttftP50: percentile(ttftSorted, 0.5),
            ttftP95: percentile(ttftSorted, 0.95),
            totalP50: percentile(totalSorted, 0.5),
            totalP95: percentile(totalSorted, 0.95)
        };
    }
    return result;
}

/**
 * 基于近 N 次成功样本的 P95，给出只读建议阈值（不自动改配置）。
 * 建议 firstToken = ttftP95 * 1.5，streamTotal = totalP95 * 1.5，留出缓冲。
 * 成功样本不足 MIN_SAMPLES_FOR_SUGGESTION 时不给出建议，避免少量样本误导。
 */
export function suggestThresholds (model) {
    const stats = getLlmTimingStats()[String(model || 'unknown')];
    if (!stats || stats.successCount < MIN_SAMPLES_FOR_SUGGESTION || !stats.totalP95) return null;
    const buffer = 1.5;
    return {
        firstTokenTimeoutMs: stats.ttftP95 ? Math.round(stats.ttftP95 * buffer) : null,
        streamTotalTimeoutMs: Math.round(stats.totalP95 * buffer),
        requestTimeoutMs: Math.round(stats.totalP95 * buffer),
        sampleCount: stats.count,
        successCount: stats.successCount,
        ttftP95: stats.ttftP95,
        totalP95: stats.totalP95
    };
}

export function __resetLlmTimingMetricsForTests () {
    buckets.clear();
    telemetrySink = null;
}
