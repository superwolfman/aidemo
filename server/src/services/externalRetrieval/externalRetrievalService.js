// 外部在线检索编排：查询 → 抓取 → 域名白名单过滤 → 段落切分 → 哈希 → 快照 → 引用。
// 外部结果与本地 Atlas 结果分离返回，绝不静默替换本地引用。
// 高风险 scope 的外部证据强制 requiresHumanReview=true；外部内容不得直接触发写操作。

import crypto from 'node:crypto';
import { searchExternal } from './externalSearchProvider.js';
import {
    getExternalRetrievalConfig,
    isDomainAllowed,
    isExternalRetrievalEligible,
    isExternalRetrievalEnabled,
    isHighRiskScope,
    resolveAuthority,
    EXTERNAL_AUTHORITY_LABELS
} from './externalRetrievalConfig.js';

const MIN_PARAGRAPH_CHARS = 24;
const MAX_PARAGRAPH_CHARS = 600;
const PROMPT_INJECTION_PATTERN = /(ignore|disregard|override)\s+(all\s+)?(previous|prior|system)\s+(instructions?|prompts?)|忽略.{0,12}(此前|之前|系统).{0,8}(指令|提示)|system\s*prompt|developer\s*message/i;

function normalizeExternalText (value, maxChars) {
    return String(value || '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxChars);
}

function redactQuery (value) {
    return String(value || '')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
        .replace(/\b1[3-9]\d{9}\b/g, '[phone]')
        .replace(/\b(?:sk|api)[-_][A-Za-z0-9._-]{12,}\b/gi, '[secret]')
        .slice(0, 1000);
}

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

async function findExistingSnapshot (store, contentHash, sourceUrl, context) {
    if (!store || typeof store.listRecords !== 'function') return null;
    try {
        const records = await store.listRecords('external_snapshots', 200, null, context);
        return records.find((item) => item.contentHash === contentHash && item.url === sourceUrl) || null;
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
        contentOrigin: raw.contentOrigin || 'provider-snippet',
        providerScore: Number.isFinite(raw.providerScore) ? raw.providerScore : null,
        domainWhitelisted: true,
        retrievalBackend: 'external-online-search',
        // 外部内容不参与向量分数，relevance 由权威等级与时效决定，明确不是 confidence
        score: null,
        relevance: 0,
        citation: {
            url: raw.url,
            crawlTime,
            paragraphCount: paragraphs.length,
            paragraphHashes: paragraphs.map((paragraph) => hashContent(paragraph.text))
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
    const eligible = isExternalRetrievalEligible({ scopes, taskModeId });
    const baseStatus = {
        enabled: cfg.enabled,
        configured: cfg.configured,
        provider: cfg.provider,
        eligible,
        highRisk: isHighRiskScope(scopes),
        timeoutMs: cfg.timeoutMs
    };

    if (!isExternalRetrievalEnabled()) {
        return { externalSources: [], externalStatus: { ...baseStatus, status: 'disabled' }, externalDiagnostics: { reason: 'EXTERNAL_SEARCH_ENABLED=false' } };
    }
    if (!cfg.configured) {
        return {
            externalSources: [],
            externalStatus: { ...baseStatus, status: 'not-configured', error: cfg.configurationError },
            externalDiagnostics: { reason: cfg.configurationError }
        };
    }
    if (!eligible) {
        return {
            externalSources: [],
            externalStatus: { ...baseStatus, status: 'scope-not-eligible' },
            externalDiagnostics: {
                reason: '当前 Task Mode 与 scope 均不在外部检索准入名单中',
                taskModeId: taskModeId || null,
                scopes
            }
        };
    }

    const startedAt = Date.now();
    const safeQuery = redactQuery(query);
    const searchResult = await searchExternal({ query: safeQuery, maxResults: cfg.maxResults, signal });

    if (!searchResult.results.length) {
        const latencyMs = Date.now() - startedAt;
        return {
            externalSources: [],
            externalStatus: { ...baseStatus, status: searchResult.status, error: searchResult.error, latencyMs },
            externalDiagnostics: { reason: searchResult.status, latencyMs }
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
        const normalizedContent = normalizeExternalText(raw.content, cfg.maxContentChars);
        if (PROMPT_INJECTION_PATTERN.test(normalizedContent)) {
            skipped.push({ url: raw.url, reason: 'prompt-injection-detected' });
            continue;
        }
        const authorityLevel = resolveAuthority(raw.url);
        const paragraphs = splitParagraphs(normalizedContent);
        if (!paragraphs.length) {
            skipped.push({ url: raw.url, reason: 'no-extractable-paragraphs' });
            continue;
        }
        const source = toExternalSource(raw, paragraphs, authorityLevel, crawlTime);
        source.requiresHumanReview = highRisk; // 高风险投研结论必须人工确认
        source.taskModeId = taskModeId || null;
        // 快照持久化 + 哈希去重
        const existing = await findExistingSnapshot(store, source.contentHash, source.sourceUrl, context);
        if (!existing) {
            await persistSnapshot(store, {
                contentHash: source.contentHash,
                url: source.sourceUrl,
                title: source.documentTitle,
                content: normalizedContent,
                paragraphs,
                crawlTime,
                publishedAt: source.publishedAt,
                authorityLevel,
                authorityLabel: source.authorityLabel,
                scopes,
                taskModeId: taskModeId || null,
                tenantId: context?.tenantId || null,
                createdBy: context?.actorId || 'system',
                expiresAt: new Date(Date.now() + cfg.snapshotTtlDays * 86_400_000)
            });
        }
        externalSources.push(source);
    }

    const nowMs = Date.now();
    for (const source of externalSources) {
        const publishedMs = source.publishedAt ? Date.parse(source.publishedAt) : NaN;
        const ageDays = Number.isFinite(publishedMs) ? Math.max(0, (nowMs - publishedMs) / 86_400_000) : null;
        const freshness = ageDays === null ? 0.45 : Math.max(0.1, Math.exp(-ageDays / 180));
        const authority = Math.max(0.2, 1 - (source.authorityLevel - 1) * 0.18);
        const providerRelevance = Number.isFinite(source.providerScore) ? Math.max(0, Math.min(1, source.providerScore)) : 0.5;
        source.relevance = Number((authority * 0.45 + freshness * 0.3 + providerRelevance * 0.25).toFixed(4));
        source.rankingSignals = { authority, freshness: Number(freshness.toFixed(4)), providerRelevance, ageDays: ageDays === null ? null : Math.round(ageDays) };
    }
    externalSources.sort((a, b) => b.relevance - a.relevance);

    try {
        await store?.createTelemetry?.({
            type: 'external_retrieval',
            tenantId: context?.tenantId,
            actorId: context?.actorId,
            queryHash: hashContent(safeQuery),
            provider: cfg.provider,
            taskModeId: taskModeId || null,
            scopes,
            fetched: searchResult.results.length,
            accepted: externalSources.length,
            skipped: skipped.length,
            latencyMs: Date.now() - startedAt
        });
    } catch { /* 审计写入失败不得阻断只读检索 */ }

    const latencyMs = Date.now() - startedAt;
    return {
        externalSources,
        externalStatus: {
            ...baseStatus,
            status: externalSources.length ? 'ok' : 'no-eligible-results',
            fetched: searchResult.results.length,
            accepted: externalSources.length,
            skipped: skipped.length,
            latencyMs
        },
        externalDiagnostics: {
            latencyMs,
            queryRedacted: safeQuery !== String(query || ''),
            skipped,
            providerStatus: searchResult.status
        }
    };
}
