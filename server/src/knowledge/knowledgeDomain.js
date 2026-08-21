import {
    CUSTOMER_SERVICE_SCOPES,
    INVESTMENT_RESEARCH_SCOPES,
    KERING_RETAIL_SCOPES
} from './domainKnowledgePacks.js';

const DOMAIN_RULES = [
    {
        id: 'kering-retail',
        pattern: /KERING|ReconKering|Greater China|跨\s*House|门店运营|门店知识|高端精品/iu,
        scopes: KERING_RETAIL_SCOPES
    },
    {
        id: 'investment-research',
        pattern: /投研|研报|研究报告|行业研究|公司研究|财务分析|财报|公告|估值|合规复核|报告生成/u,
        scopes: INVESTMENT_RESEARCH_SCOPES
    },
    {
        id: 'customer-service',
        pattern: /客服|客户服务|知识库|FAQ|问答|工单|转人工|坐席|纠错|会话|退款|服务政策/u,
        scopes: CUSTOMER_SERVICE_SCOPES
    }
];

export function resolveKnowledgeDomain (query) {
    return DOMAIN_RULES.find((rule) => rule.pattern.test(String(query || ''))) || null;
}

export function resolveKnowledgeScopes (query, requestedScopes = []) {
    const domain = resolveKnowledgeDomain(query);
    return [...new Set([...(requestedScopes || []), ...(domain?.scopes || [])])];
}

export function scopesForKnowledgeDomain (domain) {
    return DOMAIN_RULES.find((rule) => rule.id === domain)?.scopes || [];
}
