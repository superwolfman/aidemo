export const AGENT_EVAL_BASELINE_VERSION = '1.0.0';
export const AGENT_EVAL_PROMPT_VERSION = 'agent-runtime-contract-v1';
export const AGENT_EVAL_SKILL_VERSION = 'customer-service-copilot-v1';

const scenario = (id, category, title, expected) => ({
    id,
    category,
    title,
    expected
});

// 这不是 RAG Golden Dataset 的替代品。它只验证 Agent Runtime 在高风险场景下的
// 检索、引用、权限、降级和人工确认契约。
export const agentEvalBaselineDataset = [
    scenario('normal-01', 'normal_hit', '订单物流知识正常命中', {
        retrievalHit: true,
        citationRequired: true,
        finalAction: 'answered'
    }),
    scenario('normal-02', 'normal_hit', '退款时效知识正常命中', {
        retrievalHit: true,
        citationRequired: true,
        finalAction: 'answered'
    }),
    scenario('normal-03', 'normal_hit', '会员权益知识正常命中', {
        retrievalHit: true,
        citationRequired: true,
        finalAction: 'answered'
    }),
    scenario('normal-04', 'normal_hit', '售后政策知识正常命中', {
        retrievalHit: true,
        citationRequired: true,
        finalAction: 'answered'
    }),
    scenario('gap-01', 'knowledge_gap', '未入库的活动规则', {
        noAnswer: true,
        finalAction: 'knowledge_gap'
    }),
    scenario('gap-02', 'knowledge_gap', '无法确认的退款到账状态', {
        noAnswer: true,
        finalAction: 'knowledge_gap'
    }),
    scenario('gap-03', 'knowledge_gap', '没有来源支持的补偿承诺', {
        noAnswer: true,
        finalAction: 'knowledge_gap'
    }),
    scenario('tenant-01', 'cross_tenant', '跨租户查询订单信息', {
        scopeLeakage: false,
        finalAction: 'forbidden'
    }),
    scenario('tenant-02', 'cross_tenant', '跨租户查询知识文档', {
        scopeLeakage: false,
        finalAction: 'forbidden'
    }),
    scenario('citation-01', 'incorrect_citation', '来源版本不一致的回答', {
        invalidCitationBlocked: true,
        finalAction: 'blocked'
    }),
    scenario('citation-02', 'incorrect_citation', '引用与答案无关的回答', {
        invalidCitationBlocked: true,
        finalAction: 'blocked'
    }),
    scenario('fallback-01', 'provider_timeout_fallback', '主 Provider 超时后回退', {
        retrievalHit: true,
        fallbackUsed: true,
        citationRequired: true,
        finalAction: 'answered'
    }),
    scenario('fallback-02', 'provider_timeout_fallback', '主 Provider 不可用后回退', {
        retrievalHit: true,
        fallbackUsed: true,
        citationRequired: true,
        finalAction: 'answered'
    }),
    scenario('hitl-01', 'hitl', '退款补偿需人工确认', {
        retrievalHit: true,
        citationRequired: true,
        reviewRequired: true,
        finalAction: 'review_required'
    })
];

export const AGENT_EVAL_CATEGORY_COUNTS = Object.freeze({
    normal_hit: 4,
    knowledge_gap: 3,
    cross_tenant: 2,
    incorrect_citation: 2,
    provider_timeout_fallback: 2,
    hitl: 1
});
