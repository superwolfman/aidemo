import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.resolve(__dirname, '../../.cache/embeddings.json');

let memoryCache = new Map();
try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    memoryCache = new Map(Object.entries(JSON.parse(raw) || {}));
} catch {
    memoryCache = new Map();
}

function persistCache () {
    try {
        fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
        fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(memoryCache)));
    } catch {
        // 缓存写入失败不影响主流程
    }
}

const DIMENSIONS = 96;

export function tokenize (input) {
    return String(input || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

function hashToken (token) {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i += 1) {
        hash ^= token.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash);
}

export function embedText (text) {
    const vector = Array.from({ length: DIMENSIONS }, () => 0);
    const tokens = tokenize(text);
    tokens.forEach((token) => {
        const index = hashToken(token) % DIMENSIONS;
        vector[index] += 1 + Math.min(token.length, 12) / 12;
    });
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

// ===== 新增：真实 embedding（异步，带缓存，失败回退 local）=====
const embeddingConfig = {
    provider: config.embeddingProvider || 'local',
    model: config.embeddingModel || 'text-embedding-v3',
    baseUrl: config.embeddingBaseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: config.embeddingApiKey || ''
};

function isAtlasBackend () {
    return config.ragBackend === 'mongodb-atlas';
}

function isEmbeddingConfigured () {
    return embeddingConfig.provider && embeddingConfig.provider !== 'local' && embeddingConfig.apiKey;
}

function cacheKey (text) {
    let h = 2166136261;
    const s = `${embeddingConfig.provider}:${embeddingConfig.model}:${text || ''}`;
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return String(h);
}

function normalizeVector (vector, target) {
    const arr = Array.isArray(vector) ? vector.slice() : [];
    if (arr.length === target) return arr;
    if (arr.length > target) return arr.slice(0, target);
    while (arr.length < target) arr.push(0);
    return arr;
}

export async function embedTextReal (text, { useReal = false, skipCache = false } = {}) {
    if (!useReal || embeddingConfig.provider === 'local') {
        return embedText(text);
    }
    if (!embeddingConfig.apiKey) {
        // Atlas 向量库要求查询与入库使用同一份真实 embedding；
        // 若未配置 API key 却要求真实 embedding，必须显式报错，避免 96 维哈希向量污染 Atlas 索引导致 0 hits。
        if (isAtlasBackend()) {
            throw new Error(
                `Atlas RAG requires a real embedding API key. ` +
                `Set EMBEDDING_API_KEY or ensure DASHSCOPE_API_KEY/LLM_API_KEY is configured. ` +
                `Current provider: ${embeddingConfig.provider}, model: ${embeddingConfig.model}`
            );
        }
        return embedText(text);
    }
    const key = cacheKey(text);
    if (!skipCache && memoryCache.has(key)) return memoryCache.get(key);
    try {
        const target = config.ragVectorDimensions || 1536;
        const body = { model: embeddingConfig.model, input: [String(text || '')] };
        // if (embeddingConfig.provider === 'dashscope' && embeddingConfig.model.includes('text-embedding-v3')) {
        //   body.dimensions = target;
        // }
        if (embeddingConfig.provider === 'dashscope') {
            if (embeddingConfig.model.includes('text-embedding-v4')) {
                body.dimensions = target;
            } else if (embeddingConfig.model.includes('text-embedding-v3')) {
                const v3Valid = [1024, 768, 512];
                body.dimensions = v3Valid.includes(target) ? target : 1024;
            }
        }
        const res = await fetch(`${embeddingConfig.baseUrl.replace(/\/$/, '')}/embeddings`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${embeddingConfig.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const detail = await res.text();
            throw new Error(`Embedding API ${res.status}: ${detail.slice(0, 200)}`);
        }
        const payload = await res.json();
        const rawVector = payload?.data?.[0]?.embedding;
        if (!Array.isArray(rawVector)) throw new Error('Embedding response missing vector');
        const vector = normalizeVector(rawVector, target);
        memoryCache.set(key, vector);
        persistCache();
        return vector;
    } catch (error) {
        if (isAtlasBackend()) {
            // Atlas 模式下 embedding 失败必须抛错，否则会用 96 维哈希向量查询 1024 维索引，导致 0 hits 且难以排查。
            throw new Error(`[embedding] Atlas real embedding failed: ${error.message}`);
        }
        console.warn(`[embedding] fell back to local hash: ${error.message}`);
        return embedText(text);
    }
}

export function getEmbeddingDiagnostics () {
    return {
        provider: embeddingConfig.provider,
        model: embeddingConfig.model,
        dimensions: config.ragVectorDimensions,
        apiKeyConfigured: Boolean(embeddingConfig.apiKey),
        backend: config.ragBackend,
        isAtlas: isAtlasBackend(),
        effectiveProvider: isAtlasBackend() && !isEmbeddingConfigured() ? `local-fallback(${embeddingConfig.model})` : embeddingConfig.provider
    };
}
// ===== 新增结束 =====

export function cosineSimilarity (a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
    return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

export function keywordOverlap (query, content) {
    const queryTokens = new Set(tokenize(query));
    if (!queryTokens.size) return 0;
    const contentTokens = new Set(tokenize(content));
    let hits = 0;
    queryTokens.forEach((token) => {
        if (contentTokens.has(token)) hits += 1;
    });
    return hits / queryTokens.size;
}

export function splitIntoChunks (text, size = 560, overlap = 80) {
    const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];
    const paragraphs = normalized.split(/\n{2,}/);
    const chunks = [];
    let buffer = '';
    paragraphs.forEach((paragraph) => {
        const next = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
        if (next.length <= size) {
            buffer = next;
            return;
        }
        if (buffer) chunks.push(buffer);
        if (paragraph.length <= size) {
            buffer = paragraph;
            return;
        }
        for (let start = 0; start < paragraph.length; start += size - overlap) {
            chunks.push(paragraph.slice(start, start + size));
        }
        buffer = '';
    });
    if (buffer) chunks.push(buffer);
    return chunks;
}