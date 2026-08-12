// 外部在线检索编排：查询 → 抓取 → 域名白名单过滤 → 段落切分 → 哈希 → 快照 → 引用。
// 外部结果与本地 Atlas 结果分离返回，绝不静默替换本地引用。
// 高风险 scope 的外部证据强制 requiresHumanReview=true；外部内容不得直接触发写操作。

import crypto from 'node:crypto';
import { searchExternal } from './externalSearchProvider.js';
import {
    getExternalRetrievalConfig,
    isDomainAllowed,
    isExternalRetrievalEnabled,
    isHighRiskScope,
    isScopeExternalEligible,
    resolveAuthority,
    EXTERNAL_AUTHORITY_LABELS
} from './externalRetrievalConfig.js';

const MIN_PARAGRAPH_CHARS = 24;
const MAX_PARAGRAPH_CHARS = 600;

export function hashContent (text) {
    return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

/**
 * 将抓取内容切分为可引用段落，每段带稳定 index。
 * 段落用于"引用到具体段落"，避免整页引用无法定位。
 */
export function splitParagraphs (content) {
    const text = String(content || '').replace(/\r\n/g, '\n');
    const raw = text.split(/\n{1,}|\s{2,}/).map((s) => s.trim()).filter(Boolean);
    const paragraphs = [];
    for (const block of raw) {
        // 过长段落按句号切分，保证引用粒度
        if (block.length <= MAX_PARAGRAPH_CHARS) {
            if (block.length >= MIN_PARAGRAPH_CHARS) paragraphs.push(block);
            continue;
        }
        const sentences = block.split(/(?<=[。！？.!?])\s*/).filter(Boolean);
        let current = '';
        for (const sentence of sentences) {
            if ((current + sentence).length > MAX_PARAGRAPH_CHARS) {
                if (current.length >= MIN_PARAGRAPH_CHARS) paragraphs.push(current);
                current = sentence;
            } else {
                current += sentence;
            }
        }
        if (current.length >= MIN_PARAGRAPH_CHARS) paragraphs.push(current);
    }
    return paragraphs.map((text, index) => ({ index, text }));
}

async function findExistingSnapshot (store, contentHash) {
    if (!store || typeof store.listRecords !== 'function') return null;
    try {
        const records = await store.listRecords('external_snapshots', 200);
        return records.find((item) => item.contentHash === contentHash) || null;
    } catch {
        return null;
    }
}

async function persistSnapshot (store, snapshot) {
    if (!store || typeof store.createRecord !== 'function') return null;
    try {
        return await store.createRecord('external_snapshots', snapshot);
    } catch {
        return null; // 快照写入失败不阻断检索
    }
}

function toExternalSource (raw, paragraphs, authorityLevel, crawlTime) {
    const cfg = getExternalRetrievalConfig();
    const contentHash = hashContent(raw.content || raw.url);
    return {
        sourceType: 'external',
        documentTitle: raw.title || raw.url,
        sourceUrl: raw.url,
        content: paragraphs.map((p) => `[¶${p.index + 1}] ${p.text}`).join('\n'),
        paragraphs,
        contentHash,
        crawlTime,
        publishedAt: raw.publishedAt || null,
        authorityLevel,
        authorityLabel: EXTERNAL_AUTHORITY_LABELS[authorityLevel] || '未验证',
        domainWhitelisted: true,
        retrievalBackend: 'external-online-search',
        // 外部内容不参与向量分数，relevance 由权威等级与时效决定，明确不是 confidence
        score: null,
        relevance: Number((0.6 - authorityLevel * 0.08).toFixed(3)),
        citation: {
            url: raw.url,
            crawlTime,
            paragraphCount: paragraphs.length
        },
        // 外部证据不得直接触发写操作；高风险 scope 强制人工确认
        evidenceProvenance: 'external',
        writeAllowed: false
    };
}

/**
 * 外部在线检索入口。best-effort：任何失败都返回空 externalSources + 明确 status，不抛错。
 */
export async function retrieveExternalKnowledge ({ store, context, query, scopes = [], taskModeId, signal }) {
    const cfg = getExternalRetrievalConfig();
    const baseStatus = {
        enabled: cfg.enabled,
        provider: cfg.provider,
        eligible: isScopeExternalEligible(scopes),
        highRisk: isHighRiskScope(scopes)
    };

    if (!isExternalRetrievalEnabled()) {
        return { externalSources: [], externalStatus: { ...baseStatus, status: 'disabled' }, externalDiagnostics: { reason: 'EXTERNAL_SEARCH_ENABLED=false' } };
    }
    if (!isScopeExternalEligible(scopes)) {
        return { externalSources: [], externalStatus: { ...baseStatus, status: 'scope-not-eligible' }, externalDiagnostics: { reason: '当前 scope 不在 EXTERNAL_ENABLED_SCOPES 中', scopes } };
    }

    const startedAt = Date.now();
    const searchResult = await searchExternal({ query, maxResults: cfg.maxResults, signal });

    if (!searchResult.results.length) {
        return {
            externalSources: [],
            externalStatus: { ...baseStatus, status: searchResult.status, error: searchResult.error },
            externalDiagnostics: { reason: searchResult.status, latencyMs: Date.now() - startedAt }
        };
    }

    const crawlTime = new Date().toISOString();
    const highRisk = isHighRiskScope(scopes);
    const externalSources = [];
    const skipped = [];

    for (const raw of searchResult.results) {
        if (!raw?.url || !isDomainAllowed(raw.url, cfg.domainWhitelist)) {
            skipped.push({ url: raw?.url, reason: 'domain-not-whitelisted' });
            continue;
        }
        const authorityLevel = resolveAuthority(raw.url);
        const paragraphs = splitParagraphs(raw.content);
        if (!paragraphs.length) {
            skipped.push({ url: raw.url, reason: 'no-extractable-paragraphs' });
            continue;
        }
        const source = toExternalSource(raw, paragraphs, authorityLevel, crawlTime);
        source.requiresHumanReview = highRisk; // 高风险投研结论必须人工确认
        source.taskModeId = taskModeId || null;
        // 快照持久化 + 哈希去重
        const existing = await findExistingSnapshot(store, source.contentHash);
        if (!existing) {
            await persistSnapshot(store, {
                contentHash: source.contentHash,
                url: source.sourceUrl,
                title: source.documentTitle,
                content: raw.content,
                paragraphs,
                crawlTime,
                publishedAt: source.publishedAt,
                authorityLevel,
                authorityLabel: source.authorityLabel,
                scopes,
                taskModeId: taskModeId || null,
                tenantId: context?.tenantId || null
            });
        }
        externalSources.push(source);
    }

    return {
        externalSources,
        externalStatus: {
            ...baseStatus,
            status: externalSources.length ? 'ok' : 'no-eligible-results',
            fetched: searchResult.results.length,
            accepted: externalSources.length,
            skipped: skipped.length
        },
        externalDiagnostics: {
            latencyMs: Date.now() - startedAt,
            skipped,
            providerStatus: searchResult.status
        }
    };
}
