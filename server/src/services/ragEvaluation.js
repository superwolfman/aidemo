export function evaluateGoldenResults ({ cases, resultsByCase, threshold, topK = 5 }) {
    let answerable = 0;
    let recallHits = 0;
    let relevantCitations = 0;
    let returnedCitations = 0;
    let noAnswerCases = 0;
    let noAnswerHits = 0;

    for (const item of cases) {
        const ranked = (resultsByCase.get(item.id) || [])
            .filter((result) => Number(result.score || 0) >= threshold)
            .slice(0, topK);
        if (!item.shouldAnswer) {
            noAnswerCases += 1;
            if (ranked.length === 0) noAnswerHits += 1;
            continue;
        }
        answerable += 1;
        const expected = new Set(item.expectedTitles || []);
        const matching = ranked.filter((result) => expected.has(result.documentTitle || result.title));
        if (matching.length > 0) recallHits += 1;
        relevantCitations += matching.length;
        returnedCitations += ranked.length;
    }

    return {
        threshold: Number(threshold.toFixed(4)),
        recallAt5: answerable ? Number((recallHits / answerable).toFixed(4)) : 0,
        citationPrecision: returnedCitations
            ? Number((relevantCitations / returnedCitations).toFixed(4))
            : 0,
        noAnswerAccuracy: noAnswerCases
            ? Number((noAnswerHits / noAnswerCases).toFixed(4))
            : 0,
        answerableCases: answerable,
        noAnswerCases
    };
}

function candidateThresholds (resultsByCase) {
    const scores = [...resultsByCase.values()]
        .flat()
        .map((result) => Number(result.score || 0))
        .filter(Number.isFinite);
    return [...new Set([0, 1, ...scores.map((score) => Number(score.toFixed(4)))])]
        .sort((a, b) => a - b);
}

export function calibrateRelevanceThreshold ({ cases, resultsByCase, topK = 5 }) {
    const candidates = candidateThresholds(resultsByCase);
    const reports = candidates.map((threshold) => evaluateGoldenResults({
        cases,
        resultsByCase,
        threshold,
        topK
    }));

    reports.sort((a, b) => {
        const utilityA = a.recallAt5 * 0.45 + a.citationPrecision * 0.3 + a.noAnswerAccuracy * 0.25;
        const utilityB = b.recallAt5 * 0.45 + b.citationPrecision * 0.3 + b.noAnswerAccuracy * 0.25;
        return utilityB - utilityA || b.noAnswerAccuracy - a.noAnswerAccuracy || b.threshold - a.threshold;
    });
    return reports[0] || evaluateGoldenResults({ cases, resultsByCase, threshold: 1, topK });
}
