import assert from 'node:assert/strict';
import test from 'node:test';
import {
    __resetLlmTimingMetricsForTests,
    recordLlmTiming,
    getLlmTimingStats,
    suggestThresholds,
    setLlmTimingTelemetrySink
} from '../src/services/llmTimingMetrics.js';

test('records timings and computes P50/P95 plus timeout rate', () => {
    __resetLlmTimingMetricsForTests();
    for (let i = 0; i < 10; i += 1) {
        recordLlmTiming({ model: 'qwen-plus', ttftMs: 10 + i, totalMs: 100 + i, timedOut: false, provider: 'dashscope', stream: true });
    }
    recordLlmTiming({ model: 'qwen-plus', ttftMs: 0, totalMs: 30000, timedOut: true, timeoutType: 'total' });
    recordLlmTiming({ model: 'qwen-plus', ttftMs: 0, totalMs: 5000, timedOut: true, timeoutType: 'first_token' });

    const stats = getLlmTimingStats()['qwen-plus'];
    assert.equal(stats.count, 12);
    assert.equal(stats.successCount, 10);
    assert.equal(stats.timeoutCount, 2);
    assert.ok(Math.abs(stats.timeoutRate - 2 / 12) < 1e-9);
    assert.equal(stats.ttftP95, 19);
    assert.equal(stats.totalP95, 109);
});

test('timeout rate stays accurate after ring-buffer eviction (no >100% drift)', () => {
    __resetLlmTimingMetricsForTests();
    // 100 次超时 + 50 次成功，超过 SAMPLE_LIMIT(100) 触发淘汰
    for (let i = 0; i < 100; i += 1) recordLlmTiming({ model: 'evict', ttftMs: 0, totalMs: 1000, timedOut: true, timeoutType: 'total' });
    for (let i = 0; i < 50; i += 1) recordLlmTiming({ model: 'evict', ttftMs: 10, totalMs: 100, timedOut: false });
    const stats = getLlmTimingStats()['evict'];
    assert.equal(stats.count, 100); // 缓冲上限
    assert.ok(stats.timeoutRate <= 1, `timeoutRate ${stats.timeoutRate} 超过 1`);
    // 淘汰后保留的是最后 100 条（50 成功 + 50 超时），超时率应约 0.5
    assert.ok(Math.abs(stats.timeoutRate - 0.5) < 1e-9, `expected ~0.5 got ${stats.timeoutRate}`);
});

test('suggestThresholds requires minimum successful samples', () => {
    __resetLlmTimingMetricsForTests();
    // 仅 1 个成功样本（低于门槛 5）→ 不给建议
    recordLlmTiming({ model: 'sparse', ttftMs: 100, totalMs: 1000, timedOut: false });
    assert.equal(suggestThresholds('sparse'), null);
    // 补到 5 个成功样本
    for (let i = 0; i < 4; i += 1) recordLlmTiming({ model: 'sparse', ttftMs: 100 + i, totalMs: 1000 + i * 10, timedOut: false });
    const suggestion = suggestThresholds('sparse');
    assert.ok(suggestion, '达到最小样本门槛后应返回建议');
    assert.equal(suggestion.successCount, 5);
});

test('suggestThresholds returns null when no successful samples', () => {
    __resetLlmTimingMetricsForTests();
    recordLlmTiming({ model: 'empty', ttftMs: 0, totalMs: 1000, timedOut: true, timeoutType: 'total' });
    assert.equal(suggestThresholds('empty'), null);
    assert.equal(suggestThresholds('nonexistent'), null);
});

test('telemetry sink receives structured payload and survives sink failure', () => {
    __resetLlmTimingMetricsForTests();
    const received = [];
    setLlmTimingTelemetrySink((payload) => received.push(payload));
    recordLlmTiming({ model: 'sink-test', ttftMs: 50, totalMs: 500, timedOut: false, provider: 'dashscope', stream: true });
    assert.equal(received.length, 1);
    assert.equal(received[0].type, 'llm.request.timing');
    assert.equal(received[0].model, 'sink-test');
    assert.equal(received[0].provider, 'dashscope');
    assert.equal(received[0].stream, true);
    // sink 抛错不应影响主流程
    setLlmTimingTelemetrySink(() => { throw new Error('sink boom'); });
    assert.doesNotThrow(() => recordLlmTiming({ model: 'sink-test', ttftMs: 1, totalMs: 1, timedOut: false }));
});
