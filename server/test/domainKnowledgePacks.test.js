import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CUSTOMER_SERVICE_SCOPES,
    domainKnowledgeDocuments,
    INVESTMENT_RESEARCH_SCOPES,
    KERING_RETAIL_SCOPES
} from '../src/knowledge/domainKnowledgePacks.js';
import { ragGoldenDataset } from '../src/knowledge/ragGoldenDataset.js';
import { resolveKnowledgeDomain, resolveKnowledgeScopes } from '../src/knowledge/knowledgeDomain.js';
import { calibrateRelevanceThreshold, evaluateGoldenResults } from '../src/services/ragEvaluation.js';
import {
    knowledgeContentHash,
    seedKnowledge,
    seedKnowledgeIfEmpty,
    toSeedDocumentPayload
} from '../src/utils/seedKnowledge.js';

test('投研与智能客服知识包均包含完整审核元数据和精确 scope', () => {
    const investment = domainKnowledgeDocuments.filter((item) => item.knowledgeMetadata.knowledgePack === 'investment-research');
    const customerService = domainKnowledgeDocuments.filter((item) => item.knowledgeMetadata.knowledgePack === 'customer-service');
    assert.ok(investment.length >= 6);
    assert.ok(customerService.length >= 6);

    for (const item of [...investment, ...customerService]) {
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

test('KERING 定向知识包恰好包含一条官方公开资料和五条明确标注的模拟规范', () => {
    const documents = domainKnowledgeDocuments.filter((item) => (
        item.knowledgeMetadata.knowledgePack === 'kering-greater-china-retail-demo'
    ));
    const expectedTitles = [
        'KERING ReconKering 公开战略摘要',
        '高端精品集团中国区门店运营知识 Copilot 产品边界（模拟）',
        '多 House 知识隔离与权限规范（模拟）',
        '门店知识版本、有效期与发布规范（模拟）',
        '门店问答 Knowledge Gap 与转人工规范（模拟）',
        '零售 RAG 评测与上线门禁（模拟）'
    ];

    assert.deepEqual(documents.map((item) => item.title), expectedTitles);
    assert.equal(documents.length, 6);

    const official = documents.filter((item) => item.knowledgeMetadata.provenanceKind === 'public-official');
    const synthetic = documents.filter((item) => item.knowledgeMetadata.provenanceKind === 'synthetic-demo');
    assert.equal(official.length, 1);
    assert.equal(synthetic.length, 5);
    assert.equal(official[0].knowledgeMetadata.sourceType, 'official-public');
    assert.equal(official[0].knowledgeMetadata.authorityLevel, 'official');
    assert.equal(official[0].knowledgeMetadata.isSynthetic, false);
    assert.equal(
        official[0].knowledgeMetadata.sourceUri,
        'https://www.kering.com/cn/group/discover-kering/our-strategy/'
    );

    for (const item of synthetic) {
        assert.equal(item.knowledgeMetadata.sourceType, 'synthetic-demo');
        assert.equal(item.knowledgeMetadata.authorityLevel, 'synthetic-reviewed');
        assert.equal(item.knowledgeMetadata.isSynthetic, true);
        assert.ok(item.knowledgeMetadata.sourceUri.startsWith('demo://knowledge-packs/'));
        assert.match(item.knowledgeMetadata.disclaimer, /不代表 KERING/);
    }

    for (const item of documents) {
        assert.equal(item.knowledgeMetadata.reviewStatus, 'approved');
        assert.equal(item.knowledgeMetadata.usageBoundary, 'interview-demo-only');
        assert.match(item.knowledgeMetadata.version, /^\d+\.\d+\.\d+$/);
        assert.ok(item.knowledgeMetadata.effectiveAt);
        assert.ok(item.knowledgeMetadata.reviewDueAt);
        // 定向域 doc 依赖 knowledgeDomain 域识别 + 调用侧 resolveKnowledgeScopes 并入 run 检索，
        // 不要求 doc 自身携带 product-workflow 的通用 scope。
        assert.ok(item.scopes.some((scope) => KERING_RETAIL_SCOPES.includes(scope)));
        assert.ok(item.content.length > 200);
    }
});

test('KERING 定向 seed payload 保留来源等级、来源 URI 和内容哈希', () => {
    const documents = domainKnowledgeDocuments.filter((item) => (
        item.knowledgeMetadata.knowledgePack === 'kering-greater-china-retail-demo'
    ));

    for (const item of documents) {
        const payload = toSeedDocumentPayload(item);
        assert.equal(payload.sourceType, item.knowledgeMetadata.sourceType);
        assert.equal(payload.sourcePath, item.knowledgeMetadata.sourceUri);
        assert.equal(payload.sourceUpdatedAt, item.knowledgeMetadata.effectiveAt);
        assert.equal(payload.contentHash, knowledgeContentHash(item));
    }
});

test('SGS 定向知识包含一条官方公开资料和六条带前缀的模拟规范', () => {
    const documents = domainKnowledgeDocuments.filter((item) => (
        item.knowledgeMetadata.knowledgePack === 'sgs-frontend-ai-delivery-demo'
    ));
    assert.equal(documents.length, 7);

    const official = documents.filter((item) => item.knowledgeMetadata.provenanceKind === 'public-official');
    const synthetic = documents.filter((item) => item.knowledgeMetadata.provenanceKind === 'synthetic-demo');
    assert.equal(official.length, 1);
    assert.equal(synthetic.length, 6);
    assert.equal(official[0].knowledgeMetadata.sourceType, 'official-public');
    assert.equal(official[0].knowledgeMetadata.isSynthetic, false);
    assert.ok(official[0].scopes.includes('public-strategy'));

    for (const item of synthetic) {
        assert.equal(item.knowledgeMetadata.sourceType, 'synthetic-demo');
        assert.equal(item.knowledgeMetadata.authorityLevel, 'synthetic-reviewed');
        assert.equal(item.knowledgeMetadata.isSynthetic, true);
        assert.match(item.knowledgeMetadata.disclaimer, /不代表 SGS/);
        // 每条模拟规范正文以 [synthetic-demo·主题] 开头，让 rerank 可分辨来源属性
        assert.match(item.content, /^\[synthetic-demo·[^\]]+\]/);
        // 正文按 \n\n 分段，保证 chunk 粒度可拆
        assert.ok(item.content.includes('\n\n'));
        assert.ok(item.content.length > 200);
    }

    for (const item of documents) {
        assert.equal(item.knowledgeMetadata.reviewStatus, 'approved');
        assert.equal(item.knowledgeMetadata.usageBoundary, 'interview-demo-only');
        assert.ok(item.knowledgeMetadata.effectiveAt);
        assert.ok(item.knowledgeMetadata.reviewDueAt);
    }
});

test('已有租户数据库只增量创建六条 KERING seed，重复执行保持幂等', async () => {
    const created = [];
    const existingDocs = seedKnowledge
        .filter((item) => item.knowledgeMetadata?.knowledgePack !== 'kering-greater-china-retail-demo')
        .map((item, index) => ({
            _id: `existing-${index}`,
            title: item.title,
            contentHash: toSeedDocumentPayload(item).contentHash
        }));
    const documentsCollection = {
        find (query) {
            return {
                async toArray () {
                    return query.sourceType ? [] : [...existingDocs];
                }
            };
        },
        async deleteMany () {
            throw new Error('incremental KERING seed must not delete existing documents');
        },
        async deleteOne () {
            throw new Error('incremental KERING seed must not rebuild unchanged documents');
        }
    };
    const chunksCollection = {
        async countDocuments (query) {
            return query.$or ? 0 : 1;
        },
        async deleteMany () {
            throw new Error('incremental KERING seed must not delete existing chunks');
        }
    };
    const store = {
        db: {
            collection (name) {
                return name === 'documents' ? documentsCollection : chunksCollection;
            }
        },
        async countChunks () {
            return existingDocs.length;
        },
        async createDocument (context, payload) {
            const document = {
                _id: `created-${created.length}`,
                title: payload.title,
                contentHash: payload.contentHash,
                tenantId: context.tenantId
            };
            created.push(document);
            existingDocs.push(document);
            return document;
        }
    };

    const first = await seedKnowledgeIfEmpty(store, { tenantId: 'tenant-interview-demo' });
    assert.equal(first.seeded, true);
    assert.equal(first.count, 6);
    assert.ok(created.every((item) => item.tenantId === 'tenant-interview-demo'));
    assert.deepEqual(
        created.map((item) => item.title),
        domainKnowledgeDocuments
            .filter((item) => item.knowledgeMetadata.knowledgePack === 'kering-greater-china-retail-demo')
            .map((item) => item.title)
    );

    const second = await seedKnowledgeIfEmpty(store, { tenantId: 'tenant-interview-demo' });
    assert.equal(second.seeded, false);
    assert.equal(second.reason, 'all seed documents exist');
    assert.equal(created.length, 6);
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
