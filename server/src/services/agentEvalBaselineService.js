import {
    AGENT_EVAL_BASELINE_VERSION,
    AGENT_EVAL_CATEGORY_COUNTS,
    AGENT_EVAL_PROMPT_VERSION,
    AGENT_EVAL_SKILL_VERSION
} from '../eval/agentEvalBaselineDataset.js';

function asBoolean (value) {
    return value === true;
}

function ratio (numerator, denominator) {
    return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}

function percentile95 (values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function validateCases (cases) {
    const ids = new Set();
    for (const item of cases) {
        if (!item?.id || !item?.category || !item?.expected) {
            throw new Error('Agent Eval case 必须包含 id、category 和 expected');
        }
        if (ids.has(item.id)) throw new Error(`Agent Eval case id 重复: ${item.id}`);
        ids.add(item.id);
    }
}

function checkCase (item, actual) {
    const failures = [...(actual?.failures || [])];
    if (!actual) return ['missing_observation'];

    const expected = item.expected;
    if (expected.retrievalHit === true && !asBoolean(actual.retrievalHit)) failures.push('retrieval_miss');
    if (expected.noAnswer === true && !asBoolean(actual.noAnswer)) failures.push('knowledge_gap_answered');
    if (expected.scopeLeakage === false && asBoolean(actual.scopeLeakage)) failures.push('scope_leakage');
    if (expected.invalidCitationBlocked === true && !asBoolean(actual.invalidCitationBlocked)) {
        failures.push('invalid_citation_released');
    }
    if (expected.fallbackUsed === true && !asBoolean(actual.fallbackUsed)) failures.push('fallback_not_triggered');
    if (expected.reviewRequired === true && !asBoolean(actual.reviewRequired)) failures.push('hitl_missing');
    if (expected.citationRequired === true && actual.citationChecked !== true) failures.push('citation_not_checked');
    const finalActionRootCauses = new Set([
        'knowledge_gap_answered',
        'scope_leakage',
        'invalid_citation_released',
        'hitl_missing',
        'fallback_not_triggered'
    ]);
    if (expected.finalAction && actual.finalAction !== expected.finalAction && !failures.some((code) => finalActionRootCauses.has(code))) {
        failures.push('unexpected_final_action');
    }
    return [...new Set(failures)];
}

function failureSummary (failuresByCase) {
    const summary = new Map();
    for (const { id, failures } of failuresByCase) {
        for (const code of failures) {
            const current = summary.get(code) || { code, count: 0, caseIds: [] };
            current.count += 1;
            current.caseIds.push(id);
            summary.set(code, current);
        }
    }
    return [...summary.values()]
        .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));
}

/**
 * 计算 Agent Runtime 的最小回归基线。
 * observations 是 Run 的归一化观测，不调用 Provider、不修改数据库，便于 CI 复跑。
 */
export function evaluateAgentBaseline ({
    cases,
    observations,
    datasetVersion = AGENT_EVAL_BASELINE_VERSION,
    promptVersion = AGENT_EVAL_PROMPT_VERSION,
    skillVersion = AGENT_EVAL_SKILL_VERSION,
    executionMode = 'contract-fixture',
    evaluatedAt = new Date().toISOString()
}) {
    if (!Array.isArray(cases) || !Array.isArray(observations)) {
        throw new TypeError('cases 与 observations 必须为数组');
    }
    validateCases(cases);

    const observationIds = observations.map((item) => item.caseId);
    if (new Set(observationIds).size !== observationIds.length) {
        throw new Error('同一 Agent Eval case 不能导入重复 observation');
    }
    const observationsById = new Map(observations.map((item) => [item.caseId, item]));
    const unknownObservations = observations.filter((item) => !cases.some((entry) => entry.id === item.caseId));
    if (unknownObservations.length) {
        throw new Error(`发现未知 Agent Eval observation: ${unknownObservations.map((item) => item.caseId).join(', ')}`);
    }

    let expectedRetrieval = 0;
    let retrievalHits = 0;
    let citationChecked = 0;
    let validCitations = 0;
    let noAnswerCases = 0;
    let noAnswerHits = 0;
    let observedScopeCases = 0;
    let scopeLeakageCount = 0;
    let fallbackCount = 0;
    let contractPassed = 0;
    const latencies = [];
    const failuresByCase = [];

    for (const item of cases) {
        const actual = observationsById.get(item.id);
        const failures = checkCase(item, actual);
        failuresByCase.push({ id: item.id, failures });
        if (!failures.length) contractPassed += 1;

        if (item.expected.retrievalHit === true) {
            expectedRetrieval += 1;
            if (asBoolean(actual?.retrievalHit)) retrievalHits += 1;
        }
        if (actual?.citationChecked === true) {
            citationChecked += 1;
            if (asBoolean(actual.citationValid)) validCitations += 1;
        }
        if (item.expected.noAnswer === true) {
            noAnswerCases += 1;
            if (asBoolean(actual?.noAnswer)) noAnswerHits += 1;
        }
        if (item.expected.scopeLeakage === false) {
            if (actual) {
                observedScopeCases += 1;
                if (asBoolean(actual.scopeLeakage)) scopeLeakageCount += 1;
            }
        }
        if (asBoolean(actual?.fallbackUsed)) fallbackCount += 1;
        if (Number.isFinite(actual?.latencyMs) && actual.latencyMs >= 0) latencies.push(actual.latencyMs);
    }

    const topFailureModes = failureSummary(failuresByCase);
    return {
        datasetVersion,
        promptVersion,
        skillVersion,
        executionMode,
        evaluatedAt,
        totalCases: cases.length,
        scenarioDistribution: AGENT_EVAL_CATEGORY_COUNTS,
        coverage: {
            observedCases: observations.length,
            missingObservations: cases.length - observations.length
        },
        contractPassRate: ratio(contractPassed, cases.length),
        metrics: {
            recallAtK: ratio(retrievalHits, expectedRetrieval),
            citationPrecision: ratio(validCitations, citationChecked),
            noAnswerAccuracy: ratio(noAnswerHits, noAnswerCases),
            scopeLeakageRate: ratio(scopeLeakageCount, observedScopeCases),
            p95LatencyMs: percentile95(latencies),
            fallbackRate: ratio(fallbackCount, cases.length)
        },
        topFailureModes,
        cases: cases.map((item) => {
            const actual = observationsById.get(item.id) || null;
            const failures = failuresByCase.find((entry) => entry.id === item.id)?.failures || [];
            return {
                id: item.id,
                category: item.category,
                title: item.title,
                passed: failures.length === 0,
                failures,
                latencyMs: actual?.latencyMs ?? null
            };
        })
    };
}
