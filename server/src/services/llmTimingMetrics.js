// 进程内 LLM 调用耗时指标采集器（无 store 依赖，纯内存环形缓冲）。
// 用于可观测（超时率/TTFT 分布）和自适应阈值建议（基于近 N 次成功样本的 P95）。

const SAMPLE_LIMIT = 100;
const buckets = new Map(); // model -> { samples: [{ttftMs,totalMs,timedOut,timeoutType,at}], timeouts }

function bucket (model) {
    const key = String(model || 'unknown');
    let entry = buckets.get(key);
    if (!entry) {
        entry = { samples: [], timeouts: 0 };
        buckets.set(key, entry);
    }
    return entry;
}

export function recordLlmTiming ({ model, ttftMs, totalMs, timedOut, timeoutType, fallbackTriggered }) {
    const entry = bucket(model);
    entry.samples.push({
        ttftMs: Number(ttftMs) || 0,
        totalMs: Number(totalMs) || 0,
        timedOut: Boolean(timedOut),
        timeoutType: timeoutType || null,
        fallbackTriggered: Boolean(fallbackTriggered),
        at: Date.now()
    });
    if (entry.samples.length > SAMPLE_LIMIT) entry.samples.shift();
    if (timedOut) entry.timeouts += 1;
}

function percentile (sorted, p) {
    if (!sorted.length) return null;
    const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
    return sorted[index];
}

export function getLlmTimingStats () {
    const result = {};
    for (const [model, entry] of buckets.entries()) {
        const successful = entry.samples.filter((item) => !item.timedOut);
        const ttftSorted = successful.map((item) => item.ttftMs).filter(Boolean).sort((a, b) => a - b);
        const totalSorted = successful.map((item) => item.totalMs).filter(Boolean).sort((a, b) => a - b);
        result[model] = {
            count: entry.samples.length,
            timeoutCount: entry.timeouts,
            timeoutRate: entry.samples.length ? entry.samples.length : 0,
            ttftP50: percentile(ttftSorted, 0.5),
            ttftP95: percentile(ttftSorted, 0.95),
            totalP50: percentile(totalSorted, 0.5),
            totalP95: percentile(totalSorted, 0.95)
        };
        result[model].timeoutRate = entry.samples.length ? entry.timeouts / entry.samples.length : 0;
    }
    return result;
}

/**
 * 基于近 N 次成功样本的 P95，给出只读建议阈值（不自动改配置）。
 * 建议 firstToken = ttftP95 * 1.5，streamTotal = totalP95 * 1.5，留出缓冲。
 */
export function suggestThresholds (model) {
    const stats = getLlmTimingStats()[String(model || 'unknown')];
    if (!stats || !stats.totalP95) return null;
    const buffer = 1.5;
    return {
        firstTokenTimeoutMs: stats.ttftP95 ? Math.round(stats.ttftP95 * buffer) : null,
        streamTotalTimeoutMs: Math.round(stats.totalP95 * buffer),
        requestTimeoutMs: Math.round(stats.totalP95 * buffer),
        sampleCount: stats.count,
        ttftP95: stats.ttftP95,
        totalP95: stats.totalP95
    };
}

export function __resetLlmTimingMetricsForTests () {
    buckets.clear();
}
