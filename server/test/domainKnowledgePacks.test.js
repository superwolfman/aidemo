import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CUSTOMER_SERVICE_SCOPES,
    domainKnowledgeDocuments,
    INVESTMENT_RESEARCH_SCOPES
} from '../src/knowledge/domainKnowledgePacks.js';
import { ragGoldenDataset } from '../src/knowledge/ragGoldenDataset.js';
import { resolveKnowledgeDomain, resolveKnowledgeScopes } from '../src/knowledge/knowledgeDomain.js';
import { calibrateRelevanceThreshold, evaluateGoldenResults } from '../src/services/ragEvaluation.js';
import { knowledgeContentHash, toSeedDocumentPayload } from '../src/utils/seedKnowledge.js';

test('投研与智能客服知识包均包含完整审核元数据和精确 scope', () => {
    const investment = domainKnowledgeDocuments.filter((item) => item.knowledgeMetadata.knowledgePack === 'investment-research');
    const customerService = domainKnowledgeDocuments.filter((item) => item.knowledgeMetadata.knowledgePack === 'customer-service');
    assert.ok(investment.length >= 6);
    assert.ok(customerService.length >= 6);

    for (const item of domainKnowledgeDocuments) {
        assert.equal(item.knowledgeMetadata.reviewStatus, 'approved');
        assert.equal(item.knowledgeMetadata.authorityLevel, 'internal-reviewed');
        assert.match(item.knowledgeMetadata.version, /^\d+\.\d+\.\d+$/);
        assert.ok(item.knowledgeMetadata.effectiveAt);
        assert.ok(item.knowledgeMetadata.reviewDueAt);
        assert.ok(item.knowledgeMetadata.sourceUri.startsWith('internal://knowledge-packs/'));
        assert.ok(item.scopes.every((scope) => scope !== 'business'));
        assert.ok(item.content.length > 150);
    }
});

test('领域路由只在查询命中时追加对应精确 scope', () => {
    assert.equal(resolveKnowledgeDomain('生成投研报告并校验公告引用')?.id, 'investment-research');
    assert.equal(resolveKnowledgeDomain('客服答案错误后如何转人工')?.id, 'customer-service');
    assert.equal(resolveKnowledgeDomain('设计一个微前端基座'), null);

    const investmentScopes = resolveKnowledgeScopes('公司研报如何做合规复核', ['architecture']);
    assert.ok(INVESTMENT_RESEARCH_SCOPES.every((scope) => investmentScopes.includes(scope)));
    const customerOnlyScopes = CUSTOMER_SERVICE_SCOPES.filter((scope) => scope !== 'citation-compliance');
    assert.ok(!customerOnlyScopes.some((scope) => investmentScopes.includes(scope)));
});

test('精确领域 scope 不依赖宽泛 business scope', () => {
    assert.ok(domainKnowledgeDocuments.every((item) => !item.scopes.includes('business')));
    assert.ok(INVESTMENT_RESEARCH_SCOPES.includes('company-filings'));
    assert.ok(CUSTOMER_SERVICE_SCOPES.includes('knowledge-correction'));
});

test('知识内容哈希覆盖内容、scope 与审核元数据，版本升级可触发重建', () => {
    const item = domainKnowledgeDocuments[0];
    const payload = toSeedDocumentPayload(item);
    assert.equal(payload.contentHash, knowledgeContentHash(item));
    assert.equal(payload.sourceType, 'reviewed-knowledge-pack');
    assert.equal(payload.sourcePath, item.knowledgeMetadata.sourceUri);
    assert.notEqual(knowledgeContentHash(item), knowledgeContentHash({ ...item, content: `${item.content} updated` }));
});

test('Golden Dataset 同时覆盖两个领域、20+ 可回答查询和无答案案例', () => {
    assert.equal(ragGoldenDataset.length, 30);
    assert.ok(ragGoldenDataset.filter((item) => item.shouldAnswer).length >= 20);
    assert.ok(ragGoldenDataset.some((item) => item.domain === 'investment-research' && !item.shouldAnswer));
    assert.ok(ragGoldenDataset.some((item) => item.domain === 'customer-service' && !item.shouldAnswer));
});

test('阈值由 Golden Dataset 结果校准并报告 Recall@5、引用准确率和无答案识别率', () => {
    const cases = [
        { id: 'a', shouldAnswer: true, expectedTitles: ['Expected'] },
        { id: 'b', shouldAnswer: false, expectedTitles: [] }
    ];
    const resultsByCase = new Map([
        ['a', [{ documentTitle: 'Expected', score: 0.86 }, { documentTitle: 'Noise', score: 0.6 }]],
        ['b', [{ documentTitle: 'Noise', score: 0.7 }]]
    ]);
    const calibrated = calibrateRelevanceThreshold({ cases, resultsByCase });
    assert.equal(calibrated.threshold, 0.86);
    assert.equal(calibrated.recallAt5, 1);
    assert.equal(calibrated.citationPrecision, 1);
    assert.equal(calibrated.noAnswerAccuracy, 1);
    assert.deepEqual(
        evaluateGoldenResults({ cases, resultsByCase, threshold: calibrated.threshold }),
        calibrated
    );
});
