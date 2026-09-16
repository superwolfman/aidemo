import assert from 'node:assert/strict';
import test from 'node:test';
import { agentEvalBaselineDataset } from '../src/eval/agentEvalBaselineDataset.js';
import { evaluateAgentBaseline } from '../src/services/agentEvalBaselineService.js';

const observation = (caseId, overrides = {}) => ({
    caseId,
    retrievalHit: true,
    citationChecked: true,
    citationValid: true,
    noAnswer: true,
    scopeLeakage: false,
    invalidCitationBlocked: true,
    fallbackUsed: true,
    reviewRequired: true,
    finalAction: 'answered',
    latencyMs: 100,
    ...overrides
});

test('Agent Eval Baseline 保持 14 条高风险场景覆盖与稳定指标口径', () => {
    const observations = agentEvalBaselineDataset.map((item, index) => {
        const expected = item.expected;
        return observation(item.id, {
            retrievalHit: expected.retrievalHit === true,
            citationChecked: expected.citationRequired === true || expected.invalidCitationBlocked === true,
            citationValid: expected.invalidCitationBlocked ? false : true,
            noAnswer: expected.noAnswer === true,
            scopeLeakage: expected.scopeLeakage === false ? false : undefined,
            invalidCitationBlocked: expected.invalidCitationBlocked === true,
            fallbackUsed: expected.fallbackUsed === true,
            reviewRequired: expected.reviewRequired === true,
            finalAction: expected.finalAction,
            latencyMs: 100 + index
        });
    });

    const baseline = evaluateAgentBaseline({
        cases: agentEvalBaselineDataset,
        observations,
        evaluatedAt: '2026-09-16T00:00:00.000Z'
    });

    assert.equal(baseline.totalCases, 14);
    assert.deepEqual(baseline.scenarioDistribution, {
        normal_hit: 4,
        knowledge_gap: 3,
        cross_tenant: 2,
        incorrect_citation: 2,
        provider_timeout_fallback: 2,
        hitl: 1
    });
    assert.equal(baseline.contractPassRate, 1);
    assert.equal(baseline.metrics.recallAtK, 1);
    assert.equal(baseline.metrics.noAnswerAccuracy, 1);
    assert.equal(baseline.metrics.scopeLeakageRate, 0);
    assert.equal(baseline.metrics.p95LatencyMs, 113);
});

test('Agent Eval Baseline 对 Knowledge Gap、错误引用和 HITL 缺失给出可行动失败归因', () => {
    const cases = agentEvalBaselineDataset.filter((item) => [
        'gap-01', 'citation-01', 'hitl-01'
    ].includes(item.id));
    const observations = [
        observation('gap-01', { noAnswer: false, finalAction: 'answered', citationChecked: false }),
        observation('citation-01', { citationValid: false, invalidCitationBlocked: false, finalAction: 'answered' }),
        observation('hitl-01', { reviewRequired: false, finalAction: 'answered' })
    ];

    const baseline = evaluateAgentBaseline({ cases, observations });
    const failures = baseline.topFailureModes.map((item) => item.code);

    assert.equal(baseline.contractPassRate, 0);
    assert.ok(failures.includes('knowledge_gap_answered'));
    assert.ok(failures.includes('invalid_citation_released'));
    assert.ok(failures.includes('hitl_missing'));
    assert.equal(baseline.metrics.noAnswerAccuracy, 0);
    assert.equal(baseline.metrics.citationPrecision, 0.5);
});

test('Agent Eval Baseline 拒绝未知观测，避免把无关 Run 混入基线', () => {
    assert.throws(() => evaluateAgentBaseline({
        cases: agentEvalBaselineDataset,
        observations: [observation('unknown-case')]
    }), /未知 Agent Eval observation/);
});

test('Agent Eval Baseline 拒绝重复观测，避免重复 Run 稀释失败率', () => {
    assert.throws(() => evaluateAgentBaseline({
        cases: agentEvalBaselineDataset,
        observations: [observation('normal-01'), observation('normal-01')]
    }), /重复 observation/);
});
