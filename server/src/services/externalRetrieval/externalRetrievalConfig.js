// 外部在线检索策略配置：域名白名单、来源权威等级、启用的 scope、抓取策略。
// 全部 env 驱动；通过 GET /runtime-settings/external 只读暴露。
// 外部内容仅作为引用补充，不得直接触发写操作；高风险 scope 的外部证据强制人工确认。

// 已知金融/政策权威源的权威等级（1=最高，5=最低）。未登记的白名单域名默认 3。
const AUTHORITY_REGISTRY = {
    'cninfo.com.cn': 1, 'sse.com.cn': 1, 'szse.cn': 1, 'bse.cn': 1,
    'csrc.gov.cn': 1, 'pbc.gov.cn': 1, 'gov.cn': 1, 'stats.gov.cn': 1,
    'sse-info.com': 2, 'eastmoney.com': 3, '10jqka.com.cn': 3,
    'reuters.com': 2, 'bloomberg.com': 2, 'xinhuanet.com': 2,
    'wind.com.cn': 2, 'cs.com.cn': 2, 'stcn.com': 3, 'yicai.com': 3,
    'caixin.com': 2, 'thepaper.cn': 4
};

const DEFAULT_ENABLED_SCOPES = [
    'investment-research', 'research-workbench', 'company-filings',
    'industry-research', 'financial-analysis', 'research-report-generation',
    'citation-compliance'
];
const DEFAULT_HIGH_RISK_SCOPES = [
    'investment-research', 'research-report-generation', 'financial-analysis'
];
const DEFAULT_WHITELIST = [
    'cninfo.com.cn', 'sse.com.cn', 'szse.cn', 'bse.cn', 'csrc.gov.cn',
    'pbc.gov.cn', 'gov.cn', 'eastmoney.com', '10jqka.com.cn',
    'reuters.com', 'bloomberg.com', 'xinhuanet.com', 'caixin.com'
];

function listFromEnv (name, fallback = '') {
    return (process.env[name] || fallback)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
}

function booleanFromEnv (name, fallback = false) {
    const value = process.env[name];
    if (value === undefined) return fallback;
    return value === 'true';
}

function numberFromEnv (name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
}

export function getExternalRetrievalConfig () {
    return {
        enabled: booleanFromEnv('EXTERNAL_SEARCH_ENABLED', false),
        provider: process.env.EXTERNAL_SEARCH_PROVIDER || 'none',
        endpoint: process.env.EXTERNAL_SEARCH_ENDPOINT || '',
        apiKey: process.env.EXTERNAL_SEARCH_API_KEY || '',
        timeoutMs: numberFromEnv('EXTERNAL_SEARCH_TIMEOUT_MS', 8000),
        maxResults: numberFromEnv('EXTERNAL_SEARCH_MAX_RESULTS', 5),
        domainWhitelist: listFromEnv('EXTERNAL_DOMAIN_WHITELIST', DEFAULT_WHITELIST.join(',')),
        enabledScopes: listFromEnv('EXTERNAL_ENABLED_SCOPES', DEFAULT_ENABLED_SCOPES.join(',')),
        highRiskScopes: listFromEnv('EXTERNAL_HIGH_RISK_SCOPES', DEFAULT_HIGH_RISK_SCOPES.join(',')),
        authorityRegistry: { ...AUTHORITY_REGISTRY }
    };
}

export function isExternalRetrievalEnabled () {
    return getExternalRetrievalConfig().enabled;
}

export function isScopeExternalEligible (scopes = []) {
    const cfg = getExternalRetrievalConfig();
    return scopes.some((scope) => cfg.enabledScopes.includes(scope));
}

export function isHighRiskScope (scopes = []) {
    const cfg = getExternalRetrievalConfig();
    return scopes.some((scope) => cfg.highRiskScopes.includes(scope));
}

export function resolveAuthority (url) {
    const cfg = getExternalRetrievalConfig();
    try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        // 精确匹配或后缀匹配（如 gov.cn 匹配 xxx.gov.cn）
        if (cfg.authorityRegistry[host] !== undefined) return cfg.authorityRegistry[host];
        const suffixMatch = Object.keys(cfg.authorityRegistry).find((domain) => host.endsWith(domain));
        return suffixMatch ? cfg.authorityRegistry[suffixMatch] : 3;
    } catch {
        return 5; // 无法解析的 URL 给最低权威
    }
}

export function isDomainAllowed (url, whitelist = getExternalRetrievalConfig().domainWhitelist) {
    try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        return whitelist.some((domain) => host === domain || host.endsWith(`.${domain}`) || host.endsWith(domain));
    } catch {
        return false;
    }
}

export const EXTERNAL_AUTHORITY_LABELS = {
    1: '官方监管/交易所',
    2: '权威媒体/数据商',
    3: '主流财经媒体',
    4: '一般媒体',
    5: '未验证'
};
