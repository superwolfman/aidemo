import assert from 'node:assert/strict';
import test from 'node:test';
import {
    __resetLlmTimingMetricsForTests,
    recordLlmTiming,
    getLlmTimingStats,
    suggestThresholds
} from '../src/services/llmTimingMetrics.js';

test('records timings and computes P50/P95 plus timeout rate', () => {
    __resetLlmTimingMetricsForTests();
    // 10 次成功：ttft 10..19ms
    for (let i = 0; i < 10; i += 1) {
        recordLlmTiming({ model: 'qwen-plus', ttftMs: 10 + i, totalMs: 100 + i, timedOut: false });
    }
    // 2 次超时
    recordLlmTiming({ model: 'qwen-plus', ttftMs: 0, totalMs: 30000, timedOut: true, timeoutType: 'total' });
    recordLlmTiming({ model: 'qwen-plus', ttftMs: 0, totalMs: 5000, timedOut: true, timeoutType: 'first_token' });

    const stats = getLlmTimingStats()['qwen-plus'];
    assert.equal(stats.count, 12);
    assert.equal(stats.timeoutCount, 2);
    assert.ok(Math.abs(stats.timeoutRate - 2 / 12) < 1e-9);
    assert.equal(stats.ttftP95, 19); // 第 95 百分位（升序第 10 个）
    assert.equal(stats.totalP95, 109);
});

test('suggestThresholds returns P95*1.5 only from successful samples', () => {
    __resetLlmTimingMetricsForTests();
    for (let i = 0; i < 10; i += 1) {
        recordLlmTiming({ model: 'deepseek-reasoner', ttftMs: 1000 + i * 10, totalMs: 10000 + i * 100, timedOut: false });
    }
    recordLlmTiming({ model: 'deepseek-reasoner', ttftMs: 0, totalMs: 60000, timedOut: true, timeoutType: 'total' });

    const suggestion = suggestThresholds('deepseek-reasoner');
    assert.equal(suggestion.sampleCount, 11);
    // totalP95 = 10900 (升序第 10 个成功样本 = 10000+9*100=10900)；建议 = 10900*1.5 = 16350
    assert.equal(suggestion.streamTotalTimeoutMs, Math.round(10900 * 1.5));
    assert.equal(suggestion.requestTimeoutMs, Math.round(10900 * 1.5));
    // ttftP95 = 1090；建议 = 1090*1.5 = 1635
    assert.equal(suggestion.firstTokenTimeoutMs, Math.round(1090 * 1.5));
});

test('suggestThresholds returns null when no successful samples', () => {
    __resetLlmTimingMetricsForTests();
    recordLlmTiming({ model: 'empty', ttftMs: 0, totalMs: 1000, timedOut: true, timeoutType: 'total' });
    assert.equal(suggestThresholds('empty'), null);
    assert.equal(suggestThresholds('nonexistent'), null);
});
