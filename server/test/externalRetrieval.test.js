import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isDomainAllowed,
    isHighRiskScope,
    isScopeExternalEligible,
    resolveAuthority
} from '../src/services/externalRetrieval/externalRetrievalConfig.js';
import { hashContent, splitParagraphs, retrieveExternalKnowledge } from '../src/services/externalRetrieval/externalRetrievalService.js';

// 正确的 env 保存/恢复：undefined 时 delete，避免 'undefined' 字符串污染。
function withEnv (overrides) {
    const original = {};
    for (const [k, v] of Object.entries(overrides)) {
        original[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    return () => {
        for (const [k, v] of Object.entries(original)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    };
}

function mockFetchResponse (results) {
    return async () => new Response(JSON.stringify({ results }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('authority registry resolves official exchange/gov domains to level 1', () => {
    assert.equal(resolveAuthority('https://www.cninfo.com.cn/announcements'), 1);
    assert.equal(resolveAuthority('https://www.sse.com.cn/disclosure'), 1);
    assert.equal(resolveAuthority('https://www.csrc.gov.cn/pub'), 1);
    assert.equal(resolveAuthority('https://www.gov.cn/zhengce'), 1);
    assert.equal(resolveAuthority('https://example.com/news'), 3); // 未登记默认 3
    assert.equal(resolveAuthority('not-a-url'), 5); // 无法解析给最低
});

test('domain whitelist allows exact, subdomain, and suffix matches; rejects others', () => {
    const whitelist = ['cninfo.com.cn', 'gov.cn', 'eastmoney.com'];
    assert.equal(isDomainAllowed('https://www.cninfo.com.cn/x', whitelist), true);
    assert.equal(isDomainAllowed('https://sub.cninfo.com.cn/x', whitelist), true);
    assert.equal(isDomainAllowed('https://www.stats.gov.cn/x', whitelist), true); // gov.cn 后缀
    assert.equal(isDomainAllowed('https://evil-cninfo.com.cn.attacker.com/x', whitelist), false);
    assert.equal(isDomainAllowed('https://example.com/x', whitelist), false);
    assert.equal(isDomainAllowed('not-a-url', whitelist), false);
});

test('scope eligibility and high-risk classification', () => {
    const restore = withEnv({
        EXTERNAL_ENABLED_SCOPES: 'investment-research,company-filings',
        EXTERNAL_HIGH_RISK_SCOPES: 'investment-research'
    });
    try {
        assert.equal(isScopeExternalEligible(['investment-research', 'architecture']), true);
        assert.equal(isScopeExternalEligible(['architecture', 'frontend']), false);
        assert.equal(isHighRiskScope(['investment-research']), true);
        assert.equal(isHighRiskScope(['company-filings']), false);
    } finally { restore(); }
});

test('splitParagraphs splits newline-separated blocks into citeable chunks', () => {
    const content = '这是第一段足够长的内容用于引用测试，确保它超过最小字符阈值。\n\n这是第二段独立内容，同样需要超过最小阈值才能被保留。\n短。';
    const paragraphs = splitParagraphs(content);
    assert.ok(paragraphs.length >= 2);
    assert.ok(paragraphs.every((p) => p.text.length >= 24 && p.text.length <= 600));
    assert.deepEqual(paragraphs.map((p) => p.index), paragraphs.map((_, i) => i));
});

test('splitParagraphs sub-splits overly long blocks by sentence', () => {
    const longBlock = '句子一内容继续。句子二内容继续。句子三内容继续。句子四内容继续。句子五内容继续。'.repeat(20);
    const paragraphs = splitParagraphs(longBlock);
    assert.ok(paragraphs.length > 1);
    assert.ok(paragraphs.every((p) => p.text.length <= 600));
});

test('hashContent is deterministic and stable sha256', () => {
    assert.equal(hashContent('内容一'), hashContent('内容一'));
    assert.notEqual(hashContent('内容一'), hashContent('内容二'));
    assert.equal(hashContent('内容一').length, 64);
});

test('retrieveExternalKnowledge returns disabled when EXTERNAL_SEARCH_ENABLED=false', async () => {
    const restore = withEnv({ EXTERNAL_SEARCH_ENABLED: 'false' });
    try {
        const result = await retrieveExternalKnowledge({ store: null, query: 'x', scopes: ['investment-research'] });
        assert.deepEqual(result.externalSources, []);
        assert.equal(result.externalStatus.status, 'disabled');
    } finally { restore(); }
});

test('retrieveExternalKnowledge returns scope-not-eligible for non-realtime scopes', async () => {
    const restore = withEnv({ EXTERNAL_SEARCH_ENABLED: 'true' });
    try {
        const result = await retrieveExternalKnowledge({ store: null, query: 'x', scopes: ['architecture', 'frontend'] });
        assert.deepEqual(result.externalSources, []);
        assert.equal(result.externalStatus.status, 'scope-not-eligible');
    } finally { restore(); }
});

test('retrieveExternalKnowledge filters non-whitelisted domains and tags high-risk HITL', async () => {
    const restore = withEnv({
        EXTERNAL_SEARCH_ENABLED: 'true',
        EXTERNAL_SEARCH_PROVIDER: 'http-json',
        EXTERNAL_SEARCH_ENDPOINT: 'http://127.0.0.1/search',
        EXTERNAL_SEARCH_API_KEY: 'test-key',
        EXTERNAL_DOMAIN_WHITELIST: 'cninfo.com.cn'
    });
    const originalFetch = global.fetch;
    global.fetch = mockFetchResponse([
        { url: 'https://www.cninfo.com.cn/ann/123', title: '某公司公告', content: '该公司公告内容足够长用于段落切分测试，确保超过最小阈值。\n第二段独立内容同样需要足够长度。', publishedAt: '2026-08-12' },
        { url: 'https://evil.example.com/news', title: '可疑来源', content: '不应被接受的恶意来源内容。', publishedAt: '2026-08-12' }
    ]);
    const store = { listRecords: async () => [], createRecord: async (_c, payload) => payload };
    try {
        const result = await retrieveExternalKnowledge({ store, query: '某公司最新公告', scopes: ['investment-research'] });
        assert.equal(result.externalSources.length, 1);
        assert.equal(result.externalSources[0].sourceUrl, 'https://www.cninfo.com.cn/ann/123');
        assert.equal(result.externalSources[0].sourceType, 'external');
        assert.equal(result.externalSources[0].authorityLevel, 1);
        assert.equal(result.externalSources[0].writeAllowed, false);
        assert.equal(result.externalSources[0].evidenceProvenance, 'external');
        assert.equal(result.externalSources[0].requiresHumanReview, true); // investment-research 高风险
        assert.ok(result.externalSources[0].paragraphs.length >= 1);
        assert.equal(result.externalSources[0].contentHash.length, 64);
        assert.ok(result.externalSources[0].content.includes('[¶1]'));
        assert.equal(result.externalStatus.accepted, 1);
        assert.equal(result.externalDiagnostics.skipped.length, 1);
        assert.equal(result.externalDiagnostics.skipped[0].reason, 'domain-not-whitelisted');
    } finally {
        global.fetch = originalFetch;
        restore();
    }
});

test('retrieveExternalKnowledge does not tag HITL for non-high-risk scopes', async () => {
    const restore = withEnv({
        EXTERNAL_SEARCH_ENABLED: 'true',
        EXTERNAL_SEARCH_PROVIDER: 'http-json',
        EXTERNAL_SEARCH_ENDPOINT: 'http://127.0.0.1/search',
        EXTERNAL_SEARCH_API_KEY: 'test-key',
        EXTERNAL_ENABLED_SCOPES: 'company-filings',
        EXTERNAL_HIGH_RISK_SCOPES: 'investment-research'
    });
    const originalFetch = global.fetch;
    global.fetch = mockFetchResponse([
        { url: 'https://www.cninfo.com.cn/ann/456', title: '公告', content: '公告内容足够长用于段落切分测试，确保超过最小阈值。\n第二段独立内容同样需要足够长度。' }
    ]);
    try {
        const result = await retrieveExternalKnowledge({ store: { listRecords: async () => [], createRecord: async (_c, p) => p }, query: '公告', scopes: ['company-filings'] });
        assert.equal(result.externalSources.length, 1);
        assert.equal(result.externalSources[0].requiresHumanReview, false);
    } finally {
        global.fetch = originalFetch;
        restore();
    }
});

test('retrieveExternalKnowledge persists snapshot and dedups by content hash', async () => {
    const restore = withEnv({
        EXTERNAL_SEARCH_ENABLED: 'true',
        EXTERNAL_SEARCH_PROVIDER: 'http-json',
        EXTERNAL_SEARCH_ENDPOINT: 'http://127.0.0.1/search',
        EXTERNAL_SEARCH_API_KEY: 'test-key',
        EXTERNAL_DOMAIN_WHITELIST: 'cninfo.com.cn',
        EXTERNAL_ENABLED_SCOPES: 'company-filings',
        EXTERNAL_HIGH_RISK_SCOPES: 'investment-research'
    });
    const originalFetch = global.fetch;
    global.fetch = mockFetchResponse([
        { url: 'https://www.cninfo.com.cn/ann/789', title: '公告', content: '公告内容足够长用于段落切分测试，确保超过最小阈值。\n第二段独立内容同样需要足够长度。' }
    ]);
    const created = [];
    const store = { listRecords: async () => created, createRecord: async (_c, p) => { created.push(p); return p; } };
    try {
        await retrieveExternalKnowledge({ store, query: '公告', scopes: ['company-filings'] });
        assert.equal(created.length, 1);
        // 第二次同样内容 → 哈希命中 existing → 不再写入
        global.fetch = mockFetchResponse([
            { url: 'https://www.cninfo.com.cn/ann/789', title: '公告', content: '公告内容足够长用于段落切分测试，确保超过最小阈值。\n第二段独立内容同样需要足够长度。' }
        ]);
        await retrieveExternalKnowledge({ store, query: '公告', scopes: ['company-filings'] });
        assert.equal(created.length, 1); // 去重生效
    } finally {
        global.fetch = originalFetch;
        restore();
    }
});
