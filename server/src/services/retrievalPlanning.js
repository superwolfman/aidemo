import { resolveKnowledgeDomain } from '../knowledge/knowledgeDomain.js';

const TASK_MODE_SCOPES = {
    'product-workflow': ['architecture', 'standards', 'ai-native', 'frontend'],
    'requirement-analysis': ['architecture', 'standards'],
    'knowledge-assistant': ['customer-service-knowledge', 'answer-generation', 'knowledge-correction', 'citation-compliance'],
    'delivery-review': ['architecture', 'standards', 'citation-compliance']
};

const DOMAIN_SYNONYMS = {
    'investment-research': ['投研', '研报', '公司研究', '行业研究', '引用合规'],
    'customer-service': ['智能客服', '知识库', '问答', '纠错', '转人工'],
    'kering-retail': ['KERING', 'Greater China', 'House', '门店运营', '知识治理', '权限隔离', 'Knowledge Gap']
};

const ENTITY_PATTERN = /(?:[A-Za-z][A-Za-z0-9.+#_-]{1,30}|[\u4e00-\u9fff]{2,16}(?:公司|行业|平台|工作台|知识库|报告|政策|流程|系统))/gu;

export function extractBusinessEntities (query) {
    return [...new Set((String(query || '').match(ENTITY_PATTERN) || []).map((item) => item.trim()))].slice(0, 12);
}

export function buildRetrievalPlan ({ query, scopes = [], taskModeId } = {}) {
    const originalQuery = String(query || '').trim();
    const semanticQuery = originalQuery
        .replace(/\s+/g, ' ')
        .replace(/请按[^\u3002！？\n]{0,80}(?:输出|生成)[^\u3002！？\n]{0,120}/gu, '')
        .trim() || originalQuery;
    const domain = resolveKnowledgeDomain(semanticQuery);
    const entities = extractBusinessEntities(semanticQuery);
    const domainScopes = domain?.scopes || [];
    const expandedTerms = [...new Set([...entities, ...(DOMAIN_SYNONYMS[domain?.id] || [])])];
    return {
        originalQuery,
        semanticQuery,
        fullTextQuery: [semanticQuery, ...expandedTerms].filter(Boolean).join(' '),
        entities,
        domain: domain?.id || null,
        scopes: [...new Set([...(scopes || []), ...(TASK_MODE_SCOPES[taskModeId] || []), ...domainScopes])],
        taskModeId: taskModeId || null
    };
}

export function taskModeKnowledgeScopes (taskModeId) {
    return TASK_MODE_SCOPES[taskModeId] || [];
}
