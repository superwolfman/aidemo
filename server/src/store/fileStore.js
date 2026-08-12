import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cosineSimilarity, embedText, keywordOverlap } from '../utils/embedding.js';
import { hashPassword } from '../utils/password.js';
import { getRagStatus } from '../services/ragEngine.js';
import {
    DEFAULT_TENANT_ID,
    allowedScopesForListing,
    authorizeKnowledgeScopes,
    createServiceTenantContext,
    isKnowledgeRecordVisible,
    requireTenantContext
} from '../security/tenantContext.js';
import { ROLES } from '../security/roles.js';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'demo-db.json');

const seedDocs = [
    {
        title: 'AI 产品工作流落地说明',
        tags: ['copilot', 'ai-native', 'frontend', 'standards'],
        content:
            'AI 产品工作流需要把业务需求输入、上下文检索、流式生成、Artifact 输出、Agent Trace 和人工确认串成一条可恢复、可审计的链路。前端需要显式展示运行状态、失败原因、引用来源、模型配置和人工确认入口。'
    },
    {
        title: 'RAG 引用与检索质量规范',
        tags: ['copilot', 'architecture', 'standards'],
        content:
            'RAG 检索结果必须展示 query、knowledgeScopes、chunk、score、sourcePath 和 retrievalBackend。回答中应保留 citation，避免把未命中的资料当成事实。生产环境可替换为 MongoDB Atlas Vector Search、pgvector 或 Milvus。'
    },
    {
        title: 'Agent 工具调用与人工确认规范',
        tags: ['copilot', 'agent', 'architecture'],
        content:
            'Agent 可以自动执行检索、仓库分析、Artifact 生成和 Context Pack 组装。涉及写文件、发布配置、触达用户、调用真实外部系统等高风险动作必须进入 Human-in-the-loop。Trace 必须记录工具输入、输出、耗时、token 和审批状态。'
    }
];

async function readDb () {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
        return JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
    } catch {
        return { users: [], documents: [], chunks: [], tasks: [], telemetry: [] };
    }
}

async function writeDb (db) {
    await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

function now () {
    return new Date().toISOString();
}

function publicUser (user) {
    if (!user) return null;
    const { passwordHash, ...safeUser } = user;
    return safeUser;
}

function createDemoAdmin () {
    return {
        _id: crypto.randomUUID(),
        name: 'AI Copilot 管理员',
        email: config.demoAdminEmail,
        role: ROLES.ADMIN,
        tenantId: DEFAULT_TENANT_ID,
        tenants: [
            { tenantId: DEFAULT_TENANT_ID, role: ROLES.ADMIN },
            { tenantId: 'tenant-demo-2', role: ROLES.MEMBER }
        ],
        activeTenantId: DEFAULT_TENANT_ID,
        allowedKnowledgeScopes: ['*'],
        department: 'AI 产品研发',
        passwordHash: hashPassword(config.demoAdminPassword),
        tokenVersion: 0,
        createdAt: now()
    };
}

async function ensureDemoAdmin (db) {
    if (!config.seedDemoAdmin) return false;
    db.users = Array.isArray(db.users) ? db.users : [];
    const existing = db.users.find((user) => user.email === config.demoAdminEmail);
    if (existing) {
        const tenants = Array.isArray(existing.tenants) && existing.tenants.length
            ? existing.tenants
            : [{ tenantId: existing.tenantId || DEFAULT_TENANT_ID, role: existing.role || ROLES.ADMIN }];
        const next = {
            name: 'AI Copilot 管理员',
            role: ROLES.ADMIN,
            tenantId: existing.tenantId || DEFAULT_TENANT_ID,
            tenants,
            activeTenantId: existing.activeTenantId || (existing.tenantId || DEFAULT_TENANT_ID),
            allowedKnowledgeScopes: Array.isArray(existing.allowedKnowledgeScopes) ? existing.allowedKnowledgeScopes : ['*'],
            department: existing.department || 'AI 产品研发',
            tokenVersion: Number(existing.tokenVersion || 0)
        };
        const changed = Object.entries(next).some(([key, value]) => existing[key] !== value);
        Object.assign(existing, next);
        return changed;
    }
    db.users.push(createDemoAdmin());
    return true;
}

export class FileStore {
    constructor() {
        this.kind = 'file';
        this.ragStatusCache = null;
        this.ragStatusCacheAt = 0;
    }

    async init () {
        this.cache = await readDb();
        let changed = false;
        changed = await ensureDemoAdmin(this.cache) || changed;
        const seedUser = this.cache.users.find((user) => user.email === config.demoAdminEmail);
        const seedContext = createServiceTenantContext({
            tenantId: seedUser?.tenantId || config.demoTenantId || DEFAULT_TENANT_ID,
            actorId: seedUser?._id || 'system-seed'
        });
        const tenantDocuments = this.cache.documents.filter((doc) => doc.tenantId === seedContext.tenantId);
        if (!tenantDocuments.length) {
            for (const doc of seedDocs) {
                const created = await this.createDocumentInMemory(seedContext, doc);
                this.cache.documents.push(created.document);
                this.cache.chunks.push(...created.chunks);
            }
            changed = true;
        }
        if (changed) await this.flush();
    }

    async loadDb () {
        if (this.cache) return this.cache;
        if (this.cachePromise) return this.cachePromise;
        this.cachePromise = readDb().then((db) => {
            this.cache = db;
            this.cachePromise = null;
            return db;
        });
        return this.cachePromise;
    }

    async flush () {
        if (this.cache) await writeDb(this.cache);
    }

    async listRecords (collection, limit = 100, projection = null) {
        const db = await this.loadDb();
        let records = (db[collection] || []).slice(0, limit);
        if (projection) {
            records = records.map((record) => {
                const includeId = projection._id !== 0;
                const next = includeId ? { _id: record._id } : {};
                for (const key of Object.keys(record)) {
                    if (key === '_id') continue;
                    if (projection[key] === 0) continue;
                    if (projection[key] === 1 || Object.values(projection).every((v) => v === 0)) {
                        next[key] = record[key];
                    }
                }
                return next;
            });
        }
        return records;
    }

    async createRecord (collection, payload) {
        const db = await this.loadDb();
        db[collection] = db[collection] || [];
        const created = { _id: crypto.randomUUID(), ...payload, createdAt: now(), updatedAt: now() };
        db[collection].unshift(created);
        await this.flush();
        return created;
    }

    async updateRecord (collection, id, patch) {
        const db = await this.loadDb();
        db[collection] = db[collection] || [];
        const index = db[collection].findIndex((item) => item._id === id);
        if (index === -1) return null;
        db[collection][index] = { ...db[collection][index], ...patch, updatedAt: now() };
        await this.flush();
        return db[collection][index];
    }

    async compareAndSetRecord (collection, id, expectedVersion, patch) {
        const db = await this.loadDb();
        db[collection] = db[collection] || [];
        const index = db[collection].findIndex((item) => item._id === id && Number(item.version) === Number(expectedVersion));
        if (index === -1) return null;
        db[collection][index] = { ...db[collection][index], ...patch, updatedAt: now() };
        await this.flush();
        return db[collection][index];
    }

    async getRecord (collection, id) {
        const db = await this.loadDb();
        return (db[collection] || []).find((item) => item._id === id) || null;
    }


    async refreshRagStatusCache (force = false) {
        // FileStore 没有真实 vector search，直接标记为 fallback
        this.ragStatusCache = getRagStatus({ storeKind: this.kind, mode: 'fallback', vectorSearchReady: false, error: this.connectionError });
        this.ragStatusCacheAt = Date.now();
        return this.ragStatusCache;
    }

    getCachedRagStatus () {
        return this.ragStatusCache || getRagStatus({ storeKind: this.kind, mode: 'fallback', vectorSearchReady: false, error: this.connectionError });
    }

    async createDocumentInMemory (context, { title, content, tags = [], scopes = tags, sourceType = 'manual', sourcePath, sourceUpdatedAt }) {
        requireTenantContext(context);
        const authorizedScopes = authorizeKnowledgeScopes(context, scopes);
        const docId = crypto.randomUUID();
        const document = {
            _id: docId,
            tenantId: context.tenantId,
            createdBy: context.actorId,
            title,
            content,
            tags,
            scopes: authorizedScopes,
            sourceType,
            sourcePath,
            sourceUpdatedAt,
            chunkCount: 0,
            createdAt: now()
        };

        const { splitIntoChunks } = await import('../utils/embedding.js');
        const chunks = splitIntoChunks(content).map((chunk, index) => ({
            _id: crypto.randomUUID(),
            tenantId: context.tenantId,
            createdBy: context.actorId,
            documentId: docId,
            documentTitle: title,
            tags,
            scopes: authorizedScopes,
            sourceType,
            sourcePath,
            content: chunk,
            chunkIndex: index,
            embedding: embedText(chunk),
            createdAt: now()
        }));

        document.chunkCount = chunks.length;
        return { document, chunks };
    }

    async findUserByEmail (email) {
        const db = await readDb();
        return db.users.find((user) => user.email === String(email || '').trim().toLowerCase()) || null;
    }

    async findUserById (id) {
        const db = await readDb();
        return publicUser(db.users.find((user) => user._id === id));
    }

    async createDocument (context, payload) {
        requireTenantContext(context);
        const db = await readDb();
        const created = await this.createDocumentInMemory(context, payload);
        db.documents.unshift(created.document);
        db.chunks.push(...created.chunks);
        await writeDb(db);
        return created.document;
    }

    async listDocuments (context) {
        requireTenantContext(context);
        const allowedScopes = allowedScopesForListing(context);
        const db = await readDb();
        return db.documents.filter((document) => (
            document.tenantId === context.tenantId &&
            (allowedScopes === null || (document.scopes || []).some((scope) => allowedScopes.includes(scope)))
        ));
    }

    async searchChunks (context, question, { scopes = [], limit = 5 } = {}) {
        const authorizedScopes = authorizeKnowledgeScopes(context, scopes);
        const db = await readDb();
        const queryEmbedding = embedText(question);
        return db.chunks
            .filter((chunk) => isKnowledgeRecordVisible(context, chunk, authorizedScopes))
            .map((chunk) => {
                const vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding);
                const lexicalScore = keywordOverlap(question, chunk.content);
                return {
                    ...chunk,
                    score: Number((vectorScore * 0.72 + lexicalScore * 0.28).toFixed(4))
                };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    async countChunks (context) {
        requireTenantContext(context);
        const allowedScopes = allowedScopesForListing(context);
        const db = await readDb();
        return db.chunks.filter((chunk) => (
            chunk.tenantId === context.tenantId &&
            (allowedScopes === null || (chunk.scopes || []).some((scope) => allowedScopes.includes(scope)))
        )).length;
    }

    async createTask (task) {
        const db = await readDb();
        const created = { _id: crypto.randomUUID(), ...task, createdAt: now(), updatedAt: now() };
        db.tasks.unshift(created);
        await writeDb(db);
        return created;
    }

    async updateTask (id, patch) {
        const db = await readDb();
        const index = db.tasks.findIndex((task) => task._id === id);
        if (index === -1) return null;
        db.tasks[index] = { ...db.tasks[index], ...patch, updatedAt: now() };
        await writeDb(db);
        return db.tasks[index];
    }

    async getTask (id) {
        const db = await readDb();
        return db.tasks.find((task) => task._id === id) || null;
    }

    async listTasks () {
        const db = await readDb();
        return db.tasks.slice(0, 50);
    }

    async createTelemetry (event) {
        const db = await readDb();
        const created = { _id: crypto.randomUUID(), ...event, createdAt: now() };
        db.telemetry = db.telemetry || [];
        db.telemetry.unshift(created);
        db.telemetry = db.telemetry.slice(0, 500);
        await writeDb(db);
        return created;
    }

    async listTelemetry (limit = 50) {
        const db = await readDb();
        return (db.telemetry || []).slice(0, limit);
    }

}
