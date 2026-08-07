// 验证「前端可观测性」领域文档是否在 seed 检索链路中被正确召回。
// 不依赖外部 MongoDB / DashScope，仅用项目自身的真实函数复刻检索打分，跑出确定性结论。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createServiceTenantContext,
    authorizeKnowledgeScopes,
    normalizeKnowledgeScopes
} from '../src/security/tenantContext.js';
import { seedKnowledge } from '../src/utils/seedKnowledge.js';
import { embedText, cosineSimilarity, keywordOverlap, splitIntoChunks } from '../src/utils/embedding.js';
import { rerankByScopePrecision } from '../src/services/ragEngine.js';

const TENANT = 'tenant-demo';
// 用户实际入参 scopes（DeliveryCopilot 表单）
const USER_SCOPES = ['architecture', 'standards', 'ai-native', 'frontend', 'frontend-observability', 'engineering-governance', 'performance'];

// 复刻 mongoStore.searchChunks 的本地评分公式：score = cosine * 0.72 + keyword * 0.28
function scoreChunk (query, content) {
    const qv = embedText(query);
    const cv = embedText(content);
    const vectorScore = cosineSimilarity(qv, cv);
    const lexicalScore = keywordOverlap(query, content);
    return Number((vectorScore * 0.72 + lexicalScore * 0.28).toFixed(4));
}

function buildAllChunks () {
    const chunks = [];
    for (const doc of seedKnowledge) {
        for (const c of splitIntoChunks(doc.content)) {
            chunks.push({ title: doc.title, scopes: doc.scopes, content: c, sourceType: doc.sourceType || 'template' });
        }
    }
    return chunks;
}

// 1) 授权层：delivery 上下文(allowedKnowledgeScopes=['*']) 必须原样保留 frontend-observability
test('authorizeKnowledgeScopes 保留 frontend-observability', () => {
    const context = createServiceTenantContext({ tenantId: TENANT, actorId: 'test', allowedKnowledgeScopes: ['*'] });
    const authorized = authorizeKnowledgeScopes(context, USER_SCOPES);
    assert.ok(authorized.includes('frontend-observability'), 'frontend-observability 不能被授权层过滤掉');
});

// 2) 预过滤层：$vectorSearch.filter 必须让领域文档 chunk 通过
test('vector pipeline 预过滤让领域文档 chunk 命中', () => {
    const context = createServiceTenantContext({ tenantId: TENANT, actorId: 'test', allowedKnowledgeScopes: ['*'] });
    const authorized = authorizeKnowledgeScopes(context, USER_SCOPES);
    const normalized = normalizeKnowledgeScopes(authorized);
    const filter = { tenantId: { $eq: TENANT }, scopes: { $in: normalized } };

    assert.equal(filter.tenantId.$eq, TENANT);
    assert.ok(filter.scopes.$in.includes('frontend-observability'), '预过滤 $in 必须包含 frontend-observability');

    const domainScopes = ['frontend-observability', 'architecture', 'frontend']; // seed 里该文档的真实 scopes
    const intersects = domainScopes.some((s) => filter.scopes.$in.includes(s));
    assert.ok(intersects, '领域文档 chunk 必须能通过 $in 预过滤（architecture/frontend 命中）');
});

// 3) 端到端复刻：在真实 scopes 预过滤后，对全部 chunk 用项目公式打分排名
test('端到端排名：领域文档在预过滤候选中，并打印 top5', () => {
    const context = createServiceTenantContext({ tenantId: TENANT, actorId: 'test', allowedKnowledgeScopes: ['*'] });
    const authorized = authorizeKnowledgeScopes(context, USER_SCOPES);
    const prefilter = new Set(normalizeKnowledgeScopes(authorized));

    const allChunks = buildAllChunks();
    const candidates = allChunks.filter((c) => c.scopes.some((s) => prefilter.has(s)));
    const domainCandidates = candidates.filter((c) => c.title === '前端可观测性与高可用架构');
    assert.ok(domainCandidates.length > 0, '领域文档应作为预过滤候选存在');

    const queries = {
        generic: '建设一个前端可观测性平台从需求到交付',
        rich: '建设一个前端可观测性平台从需求到交付：实现错误采集与 Source Map 反解、Web Vitals 与白屏监控、TraceId 全链路追踪、告警分级与 MTTR 闭环、灰度回滚高可用架构'
    };

    for (const [name, q] of Object.entries(queries)) {
        const ranked = candidates
            .map((c) => ({ title: c.title, score: scoreChunk(q, c.content) }))
            .sort((a, b) => b.score - a.score);
        const top5 = ranked.slice(0, 5).map((r) => r.title);
        const domainRank = ranked.findIndex((r) => r.title === '前端可观测性与高可用架构') + 1;
        // 打印决定性证据（node --test 会显示 console.log）
        console.log(`\n[query=${name}] 候选chunk数=${candidates.length} 领域文档排名=${domainRank} top5=${JSON.stringify(top5)}`);
        assert.ok(domainRank > 0, '领域文档必须参与排名');
    }
});

// 4) 加入 scope 精确度重排序后，领域文档应进入 generic 查询的 top5
//（模拟 ragEngine.retrieveKnowledge 在 Atlas 分支的完整流程：向量打分 → scope precision rerank）
test('加入 scope precision rerank 后，领域文档进入 generic 查询 top5', () => {
    const authorized = USER_SCOPES;
    const prefilter = new Set(normalizeKnowledgeScopes(authorized));
    const allChunks = buildAllChunks();
    const candidates = allChunks.filter((c) => c.scopes.some((s) => prefilter.has(s)));
    const query = '建设一个前端可观测性平台从需求到交付';

    const scored = candidates
        .map((c) => ({
            title: c.title,
            score: scoreChunk(query, c.content),
            scopes: c.scopes,
            sourceType: c.sourceType
        }));

    const reranked = rerankByScopePrecision(scored, authorized);
    const top5 = reranked.slice(0, 5).map((r) => r.title);
    const domainRank = reranked.findIndex((r) => r.title === '前端可观测性与高可用架构') + 1;

    console.log(`\n[rerank] generic 查询：领域文档排名=${domainRank} top5=${JSON.stringify(top5)}`);
    assert.ok(domainRank > 0 && domainRank <= 5, `加入 scope precision rerank 后，领域文档必须进入 top5，当前排名=${domainRank}`);
});
