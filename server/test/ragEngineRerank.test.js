// 验证 ragEngine 的 scope 精确度重排序逻辑。
// 不依赖外部服务，仅对 rerankByScopePrecision 做纯函数单测。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyOddsFactor,
    buildRetrievalOutcome,
    buildVectorSearchPlan,
    filterSourcesByMinimumScore,
    fuseHybridResults,
    rerankByEvidenceQuality,
    rerankByScopePrecision
} from '../src/services/ragEngine.js';
import { buildRetrievalPlan, extractBusinessEntities } from '../src/services/retrievalPlanning.js';

function makeSource ({ title, score, scopes, sourceType = 'manual' }) {
    return { title, score, scopes, sourceType };
}

const USER_SCOPES = ['architecture', 'standards', 'ai-native', 'frontend', 'frontend-observability', 'engineering-governance', 'performance'];

test('top5 检索使用与线上诊断一致的 20 条重排候选池', () => {
    assert.deepEqual(buildVectorSearchPlan(5), {
        topK: 5,
        candidateLimit: 20,
        numCandidates: 320
    });
});

test('odds 加权保持相关度在 0 到 1，且不会像 clamp 一样丢失差异', () => {
    const first = applyOddsFactor(0.8679, 1.5);
    const second = applyOddsFactor(0.8584, 1.5);

    assert.ok(first > second);
    assert.ok(first <= 1 && second >= 0);
    assert.equal(first, 0.9079);
    assert.equal(applyOddsFactor(0, 1.5), 0);
    assert.equal(applyOddsFactor(1, 1.5), 1);
});

test('弱相关 Atlas 候选在业务加权前被拒绝，不能靠 scope boost 进入 topK', () => {
    const sources = [
        makeSource({ title: '无关工程规范', score: 0.7726, scopes: ['sdk'] }),
        makeSource({ title: '投研报告业务规范', score: 0.8342, scopes: ['standards'] })
    ];

    const accepted = filterSourcesByMinimumScore(sources, 0.8);
    assert.deepEqual(accepted.map((source) => source.title), ['投研报告业务规范']);
});

test('命中精确领域 scope 的 chunk 得分被 boost，排名上升', () => {
    const sources = [
        makeSource({ title: 'Copilot BFF 路由源码', score: 0.86, scopes: ['architecture'], sourceType: 'project-file' }),
        makeSource({ title: '前端可观测性与高可用架构', score: 0.82, scopes: ['frontend-observability', 'architecture', 'frontend'], sourceType: 'template' })
    ];

    const result = rerankByScopePrecision(sources, USER_SCOPES);

    assert.equal(result[0].title, '前端可观测性与高可用架构');
    assert.ok(result[0].score > result[1].score, '领域文档重排后得分必须高于 Copilot 源码');
    assert.ok(result[0].rerankReason.includes('scope precision odds boost'));
    assert.ok(result[0].rerankReason.includes('frontend-observability'));
});

test('未命中精确 scope 的 project-file 被 penalty，排名下降', () => {
    const sources = [
        makeSource({ title: 'Copilot 工作台前端源码', score: 0.90, scopes: ['frontend', 'architecture'], sourceType: 'project-file' }),
        makeSource({ title: '需求到交付 Agent 产品设计指南', score: 0.85, scopes: ['standards'], sourceType: 'template' })
    ];

    const result = rerankByScopePrecision(sources, USER_SCOPES);

    assert.equal(result[0].title, '需求到交付 Agent 产品设计指南');
    assert.ok(result[1].rerankReason.includes('project-file odds penalty'));
});

test('无精确 scope 时，宽泛 scope 来源不惩罚非 project-file 类型', () => {
    const sources = [
        makeSource({ title: '需求到交付 Agent 产品设计指南', score: 0.80, scopes: ['standards'], sourceType: 'template' }),
        makeSource({ title: '应用群工程与交付治理案例', score: 0.75, scopes: ['engineering-governance'], sourceType: 'template' })
    ];

    const result = rerankByScopePrecision(sources, USER_SCOPES);

    assert.equal(result[0].title, '应用群工程与交付治理案例');
    assert.equal(result[1].title, '需求到交付 Agent 产品设计指南');
    assert.ok(!result[1].rerankReason.includes('penalty'));
});

test('空数组安全返回', () => {
    const result = rerankByScopePrecision([], USER_SCOPES);
    assert.deepEqual(result, []);
});

test('命中多个精确 scope 不重复乘 factor（只判定是否命中）', () => {
    const sources = [
        makeSource({ title: 'A', score: 0.80, scopes: ['frontend-observability', 'performance'], sourceType: 'template' }),
        makeSource({ title: 'B', score: 0.85, scopes: ['frontend'], sourceType: 'project-file' })
    ];

    const result = rerankByScopePrecision(sources, USER_SCOPES);

    assert.equal(result[0].title, 'A');
    assert.ok(result[0].score > result[1].score);
    assert.equal(result[0].score, applyOddsFactor(0.80, 1.5));
    assert.ok(result.every((source) => source.score >= 0 && source.score <= 1));
});

test('Atlas 高原始分经过 boost 后仍不超过 1，并保持领域文档优先', () => {
    const sources = [
        makeSource({ title: 'Copilot 工作台前端源码', score: 0.92, scopes: ['frontend', 'architecture'], sourceType: 'project-file' }),
        makeSource({ title: 'Copilot BFF 路由源码', score: 0.90, scopes: ['architecture'], sourceType: 'project-file' }),
        makeSource({ title: '前端可观测性与高可用架构', score: 0.84, scopes: ['frontend-observability', 'architecture', 'frontend'], sourceType: 'template' })
    ];

    const result = rerankByScopePrecision(sources, USER_SCOPES);

    assert.equal(result[0].title, '前端可观测性与高可用架构');
    assert.ok(result[1].score < result[0].score);
    assert.ok(result[2].score < result[0].score);
    assert.equal(result[0].score, applyOddsFactor(0.84, 1.5));
    assert.ok(result.every((source) => source.score >= 0 && source.score <= 1));
});

test('Query 规划保留原始需求，提取业务实体并联动 Task Mode scope', () => {
    const plan = buildRetrievalPlan({
        query: '建设智能客服知识库平台，支持 FAQ 纠错和转人工',
        scopes: ['architecture'],
        taskModeId: 'knowledge-assistant'
    });

    assert.equal(plan.domain, 'customer-service');
    assert.ok(plan.scopes.includes('customer-service-knowledge'));
    assert.ok(plan.scopes.includes('knowledge-correction'));
    assert.ok(plan.entities.includes('FAQ'));
    assert.deepEqual(extractBusinessEntities('React API 客服平台'), ['React', 'API', '客服平台']);
});

test('混合检索使双通道命中来源优先，且合并后分数有界', () => {
    const vector = [
        { _id: 'shared', documentTitle: '投研报告规范', content: '投研报告工作台', vectorScore: 0.84, score: 0.84 },
        { _id: 'vector-only', documentTitle: '工程规范', content: '通用工程', vectorScore: 0.83, score: 0.83 }
    ];
    const text = [
        { _id: 'shared', documentTitle: '投研报告规范', content: '投研报告工作台', textScore: 1, score: 1 }
    ];
    const result = fuseHybridResults(vector, text, { entities: ['投研报告工作台'] });

    assert.equal(result[0]._id, 'shared');
    assert.deepEqual(result[0].retrievalChannels, ['vector', 'text']);
    assert.ok(result.every((source) => source.score >= 0 && source.score <= 1));
});

test('证据质量排序优先已审核时效来源，并排除过期来源', () => {
    const now = new Date('2026-08-12T00:00:00.000Z');
    const result = rerankByEvidenceQuality([
        { _id: 'official', score: 0.8, knowledgeMetadata: { authorityLevel: 'internal-reviewed', reviewDueAt: '2027-01-01T00:00:00.000Z' } },
        { _id: 'unknown', score: 0.81, knowledgeMetadata: {} },
        { _id: 'expired', score: 0.95, knowledgeMetadata: { expiresAt: '2026-01-01T00:00:00.000Z' } }
    ], {}, now);

    assert.deepEqual(result.map((source) => source._id), ['official', 'unknown']);
    assert.equal(result[0].evidenceQuality.authority, 'internal-reviewed');
});

test('0 hits 是 knowledge_gap，不是检索故障', () => {
    assert.deepEqual(buildRetrievalOutcome([], { chunkCount: 20, effectiveScopes: ['architecture'] }), {
        type: 'knowledge_gap',
        code: 'NO_RELEVANT_EVIDENCE',
        message: '检索服务正常，但当前知识库没有足够可靠的相关证据。',
        effectiveScopes: ['architecture']
    });
    assert.deepEqual(buildRetrievalOutcome([{ _id: 'hit' }]), { type: 'success', hitCount: 1 });
});
