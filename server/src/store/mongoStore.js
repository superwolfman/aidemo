import { MongoClient, ObjectId } from 'mongodb';
import { config } from '../config.js';
import { cosineSimilarity, embedText, embedTextReal, keywordOverlap, splitIntoChunks } from '../utils/embedding.js';
import { hashPassword } from '../utils/password.js';
import { getRagStatus } from '../services/ragEngine.js';
import { seedKnowledgeIfEmpty } from '../utils/seedKnowledge.js';
import {
    DEFAULT_TENANT_ID,
    allowedScopesForListing,
    authorizeKnowledgeScopes,
    createServiceTenantContext,
    normalizeKnowledgeScopes,
    requireTenantContext,
    tenantFilter,
    tenantUserFilter
} from '../security/tenantContext.js';
import { ROLES } from '../security/roles.js';
import {
    ensureMongoDatabaseEnvironment,
    validateMongoRuntimeRoles
} from './mongoDatabase.js';

function now () {
    return new Date();
}

function serialize (document) {
    if (!document) return null;
    return { ...document, _id: String(document._id) };
}

export function buildTenantVectorPipeline ({
    context,
    scopes,
    queryEmbedding,
    limit,
    numCandidates,
    tenantOnly = false
}) {
    requireTenantContext(context);
    const normalizedScopes = normalizeKnowledgeScopes(scopes);
    const filter = { tenantId: { $eq: context.tenantId } };
    if (!tenantOnly && normalizedScopes.length) {
        filter.scopes = { $in: normalizedScopes };
    }
    return [
        {
            $vectorSearch: {
                index: config.ragVectorIndex,
                path: config.ragVectorPath,
                queryVector: queryEmbedding,
                numCandidates: Math.max(numCandidates, limit * 8),
                limit,
                filter
            }
        },
        {
            $project: {
                documentId: 1,
                documentTitle: 1,
                tenantId: 1,
                tags: 1,
                scopes: 1,
                sourceType: 1,
                sourcePath: 1,
                sourceUpdatedAt: 1,
                knowledgeMetadata: 1,
                contentHash: 1,
                content: 1,
                chunkIndex: 1,
                createdAt: 1,
                vectorScore: { $meta: 'vectorSearchScore' }
            }
        }
    ];
}

export function buildTenantTextPipeline ({ context, scopes, query, limit }) {
    requireTenantContext(context);
    const normalizedScopes = normalizeKnowledgeScopes(scopes);
    const filter = [{ equals: { path: 'tenantId', value: context.tenantId } }];
    if (normalizedScopes.length) filter.push({ in: { path: 'scopes', value: normalizedScopes } });
    return [
        {
            $search: {
                index: config.ragTextIndex,
                compound: {
                    must: [{ text: { query, path: ['documentTitle', 'content'] } }],
                    filter
                }
            }
        },
        { $limit: limit },
        {
            $project: {
                documentId: 1, documentTitle: 1, tenantId: 1, tags: 1, scopes: 1,
                sourceType: 1, sourcePath: 1, sourceUpdatedAt: 1, knowledgeMetadata: 1,
                contentHash: 1, content: 1, chunkIndex: 1, createdAt: 1,
                textScore: { $meta: 'searchScore' }
            }
        }
    ];
}

export class MongoStore {
    constructor(uri, databaseName = config.mongodbDatabase, environment = config.mongodbEnvironment) {
        // this.uri = uri;
        // this.kind = 'mongo';
        this.uri = uri;
        this.databaseName = databaseName;
        this.environment = environment;
        this.kind = 'mongo';
        this.ragStatusCache = null;
        this.ragStatusCacheAt = 0;
    }

    async refreshRagStatusCache (force = false) {
        const now = Date.now();
        if (!force && this.ragStatusCache && now - this.ragStatusCacheAt < 30_000) {
            return this.ragStatusCache;
        }
        try {
            const vs = await this.checkVectorSearch();
            if (vs.ok) {
                this.ragStatusCache = getRagStatus({ storeKind: this.kind, mode: 'live', vectorSearchReady: true });
            } else {
                this.ragStatusCache = getRagStatus({ storeKind: this.kind, mode: 'fallback', vectorSearchReady: false, error: vs.error });
            }
        } catch (e) {
            this.ragStatusCache = getRagStatus({ storeKind: this.kind, error: e.message });
        }
        this.ragStatusCacheAt = now;
        return this.ragStatusCache;
    }

    getCachedRagStatus () {
        return this.ragStatusCache || getRagStatus({ storeKind: this.kind, error: 'RAG status not ready yet' });
    }

    async init () {
        const isAtlasSrv = this.uri.startsWith('mongodb+srv://');
        this.client = new MongoClient(this.uri, {
            serverSelectionTimeoutMS: isAtlasSrv ? 6000 : 1800,
            connectTimeoutMS: isAtlasSrv ? 6000 : 1800,
            socketTimeoutMS: isAtlasSrv ? 10000 : 5000,
            tls: isAtlasSrv ? true : undefined,
            retryWrites: isAtlasSrv ? true : undefined
        });
        await this.client.connect();
        this.db = this.client.db(this.databaseName);
        if (this.environment === 'production') {
            const status = await this.client.db('admin').command({
                connectionStatus: 1,
                showPrivileges: false
            });
            const roleErrors = validateMongoRuntimeRoles({
                databaseName: this.databaseName,
                roles: status.authInfo?.authenticatedUserRoles || []
            });
            if (roleErrors.length) {
                throw new Error(`Unsafe MongoDB application identity:\n- ${roleErrors.join('\n- ')}`);
            }
        }
        await ensureMongoDatabaseEnvironment(this.db, this.environment);

        await this.db.collection('users').createIndex({ email: 1 }, { unique: true });
        await this.db.collection('documents').createIndex({ tenantId: 1, createdAt: -1 });
        await this.db.collection('documents').createIndex({ tenantId: 1, sourceType: 1, title: 1 });
        await this.db.collection('chunks').createIndex({ tenantId: 1, documentId: 1 });
        await this.db.collection('chunks').createIndex({ tenantId: 1, scopes: 1 });
        await this.db.collection('tasks').createIndex({ createdAt: -1 });
        await this.db.collection('telemetry').createIndex({ createdAt: -1 });
        await this.db.collection('telemetry').createIndex({ traceId: 1 });
        await this.db.collection('agent_sessions').createIndex({ createdAt: -1 });
        await this.db.collection('agent_runs').createIndex({ createdAt: -1 });
        await this.db.collection('runtime_settings').createIndex({ key: 1 }, { unique: true });
        await this.db.collection('runtime_setting_versions').createIndex({ settingKey: 1, version: -1 }, { unique: true });
        await this.db.collection('external_snapshots').createIndex({ tenantId: 1, createdBy: 1, url: 1, contentHash: 1 }, { unique: true });
        await this.db.collection('external_snapshots').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
        await this.ensureVectorIndex();
        await this.ensureTextIndex();

        await this.seed();
        // 后台异步预探测，不阻塞 init
        this.refreshRagStatusCache(true).catch(() => { });
    }

    async ensureVectorIndex () {
        if (!config.ragCreateVectorIndex) return;
        const chunks = this.db.collection('chunks');
        if (typeof chunks.createSearchIndex !== 'function') return;

        try {
            await chunks.createSearchIndex({
                name: config.ragVectorIndex,
                type: 'vectorSearch',
                definition: {
                    fields: [
                        {
                            type: 'vector',
                            path: config.ragVectorPath,
                            numDimensions: config.ragVectorDimensions,
                            similarity: 'cosine'
                        },
                        {
                            type: 'filter',
                            path: 'tenantId'
                        },
                        {
                            type: 'filter',
                            path: 'scopes'
                        }
                    ]
                }
            });
            console.log(`[rag] requested MongoDB Atlas Vector Search index: ${config.ragVectorIndex}`);
        } catch (error) {
            console.warn(`[rag] skip vector index creation: ${error.message}`);
        }
    }

    async ensureTextIndex () {
        const chunks = this.db.collection('chunks');
        if (typeof chunks.createSearchIndex !== 'function') return;
        try {
            if (typeof chunks.listSearchIndexes === 'function') {
                const indexes = await chunks.listSearchIndexes(config.ragTextIndex).toArray();
                if (indexes.length) return;
            }
            await chunks.createSearchIndex({
                name: config.ragTextIndex,
                definition: {
                    mappings: {
                        dynamic: false,
                        fields: {
                            tenantId: { type: 'token' },
                            scopes: { type: 'token' },
                            documentTitle: { type: 'string' },
                            content: { type: 'string' }
                        }
                    }
                }
            });
            console.log(`[rag] requested MongoDB Atlas Search index: ${config.ragTextIndex}`);
        } catch (error) {
            console.warn(`[rag] skip text index creation: ${error.message}`);
        }
    }

    async seed () {
        const users = this.db.collection('users');
        let existingUser = await users.findOne({ email: config.demoAdminEmail });
        if (config.seedDemoAdmin && !existingUser) {
            const result = await users.insertOne({
                name: '增长平台管理员',
                email: config.demoAdminEmail,
                role: ROLES.ADMIN,
                tenantId: DEFAULT_TENANT_ID,
                tenants: [
                    { tenantId: DEFAULT_TENANT_ID, role: ROLES.ADMIN },
                    { tenantId: 'tenant-demo-2', role: ROLES.MEMBER }
                ],
                activeTenantId: DEFAULT_TENANT_ID,
                allowedKnowledgeScopes: ['*'],
                department: '用户增长',
                passwordHash: hashPassword(config.demoAdminPassword),
                tokenVersion: 0,
                createdAt: now()
            });
            existingUser = await users.findOne({ _id: result.insertedId });
        } else if (existingUser && (!existingUser.tenantId || !Array.isArray(existingUser.allowedKnowledgeScopes) || !Array.isArray(existingUser.tenants))) {
            const tenants = Array.isArray(existingUser.tenants) && existingUser.tenants.length
                ? existingUser.tenants
                : [{ tenantId: existingUser.tenantId || DEFAULT_TENANT_ID, role: existingUser.role || ROLES.ADMIN }];
            await users.updateOne(
                { _id: existingUser._id },
                {
                    $set: {
                        tenantId: existingUser.tenantId || DEFAULT_TENANT_ID,
                        allowedKnowledgeScopes: ['*'],
                        tenants,
                        activeTenantId: existingUser.activeTenantId || (existingUser.tenantId || DEFAULT_TENANT_ID)
                    }
                }
            );
            existingUser = await users.findOne({ _id: existingUser._id });
        }

        // 多租户 seed：为当前用户关联的每个租户单独注入 seed 文档，避免 tenant-demo-2 无数据
        const uniqueTenantIds = existingUser ? [
            ...new Set([
                existingUser.tenantId || DEFAULT_TENANT_ID,
                ...(Array.isArray(existingUser.tenants) ? existingUser.tenants.map((t) => t.tenantId) : [])
            ].filter(Boolean))
        ] : [config.demoTenantId || DEFAULT_TENANT_ID];
        for (const tenantId of uniqueTenantIds) {
            await seedKnowledgeIfEmpty(this, {
                tenantId,
                actorId: existingUser ? String(existingUser._id) : 'system-seed'
            });
        }
    }

    async findUserByEmail (email) {
        return this.db.collection('users').findOne({ email: String(email || '').trim().toLowerCase() });
    }

    async findUserById (id) {
        const user = await this.db.collection('users').findOne({ _id: new ObjectId(id) });
        if (!user) return null;
        const { passwordHash, ...safeUser } = user;
        return serialize(safeUser);
    }

    async createDocument (context, { title, content, tags = [], scopes = [], sourceType = 'manual', sourcePath, sourceUpdatedAt, knowledgeMetadata, contentHash }) {
        requireTenantContext(context);
        const authorizedScopes = authorizeKnowledgeScopes(context, scopes);
        const chunks = splitIntoChunks(content);
        const document = {
            tenantId: context.tenantId,
            createdBy: context.actorId,
            title,
            content,
            tags,
            scopes: authorizedScopes,
            sourceType,
            sourcePath,
            sourceUpdatedAt,
            knowledgeMetadata,
            contentHash,
            chunkCount: chunks.length,
            createdAt: now()
        };
        const result = await this.db.collection('documents').insertOne(document);
        const inserted = { ...document, _id: result.insertedId };

        if (chunks.length) {
            const embedded = [];
            for (const chunk of chunks) {
                embedded.push({
                    tenantId: context.tenantId,
                    createdBy: context.actorId,
                    documentId: result.insertedId,
                    documentTitle: title,
                    tags,
                    scopes: authorizedScopes,
                    sourceType,
                    sourcePath,
                    sourceUpdatedAt,
                    knowledgeMetadata,
                    contentHash,
                    content: chunk,
                    chunkIndex: embedded.length,
                    embedding: config.ragBackend === 'mongodb-atlas'
                        ? await embedTextReal(chunk, { useReal: true })
                        : embedText(chunk),
                    createdAt: now()
                });
            }
            await this.db.collection('chunks').insertMany(embedded);
        }

        return serialize(inserted);
    }

    async listDocuments (context) {
        const allowedScopes = allowedScopesForListing(context);
        const filter = allowedScopes === null
            ? tenantFilter(context)
            : { tenantId: context.tenantId, scopes: { $in: allowedScopes } };
        const docs = await this.db.collection('documents').find(filter).sort({ createdAt: -1 }).toArray();
        return docs.map(serialize);
    }

    async searchChunks (context, question, { scopes = [], limit = 5 } = {}) {
        const authorizedScopes = authorizeKnowledgeScopes(context, scopes);
        const chunks = await this.db.collection('chunks').find({
            tenantId: context.tenantId,
            scopes: { $in: authorizedScopes }
        }).toArray();
        const queryEmbedding = await embedTextReal(question, { useReal: true });
        return chunks
            .map((chunk) => {
                const vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding);
                const lexicalScore = keywordOverlap(question, chunk.content);
                return serialize({
                    ...chunk,
                    documentId: String(chunk.documentId),
                    score: Number((vectorScore * 0.72 + lexicalScore * 0.28).toFixed(4))
                });
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    async searchVectorChunks (context, question, { scopes = [], limit = 5, numCandidates = 80 } = {}) {
        const authorizedScopes = authorizeKnowledgeScopes(context, scopes);
        const queryEmbedding = await embedTextReal(question, { useReal: true });

        const pipeline = buildTenantVectorPipeline({
            context,
            scopes: authorizedScopes,
            queryEmbedding,
            limit,
            numCandidates
        });

        let chunks = await this.db.collection('chunks').aggregate(pipeline).toArray();

        return chunks.map((chunk) => serialize({
            ...chunk,
            documentId: String(chunk.documentId),
            score: Number((chunk.vectorScore || 0).toFixed(4)),
            retrievalBackend: 'mongodb-atlas-vector-search'
        }));
    }

    async searchTextChunks (context, question, { scopes = [], limit = 20 } = {}) {
        const authorizedScopes = authorizeKnowledgeScopes(context, scopes);
        const chunks = await this.db.collection('chunks').aggregate(buildTenantTextPipeline({
            context,
            scopes: authorizedScopes,
            query: question,
            limit
        })).toArray();
        const maximumScore = Math.max(...chunks.map((chunk) => Number(chunk.textScore || 0)), 1);
        return chunks.map((chunk) => serialize({
            ...chunk,
            documentId: String(chunk.documentId),
            atlasTextScore: Number(chunk.textScore || 0),
            score: Number((Number(chunk.textScore || 0) / maximumScore).toFixed(4)),
            textScore: Number((Number(chunk.textScore || 0) / maximumScore).toFixed(4)),
            retrievalBackend: 'mongodb-atlas-full-text-search'
        }));
    }

    async countChunks (context) {
        const allowedScopes = allowedScopesForListing(context);
        const filter = allowedScopes === null
            ? tenantFilter(context)
            : { tenantId: context.tenantId, scopes: { $in: allowedScopes } };
        return this.db.collection('chunks').countDocuments(filter);
    }

    async getRagCalibration (context, domain) {
        requireTenantContext(context);
        return this.db.collection('rag_calibrations').findOne({
            tenantId: context.tenantId,
            domain,
            active: true
        }, { sort: { evaluatedAt: -1 } });
    }

    async saveRagCalibration (context, profile) {
        requireTenantContext(context);
        const record = {
            ...profile,
            tenantId: context.tenantId,
            active: true,
            updatedBy: context.actorId,
            updatedAt: now()
        };
        await this.db.collection('rag_calibrations').updateOne(
            { tenantId: context.tenantId, domain: profile.domain, active: true },
            { $set: record },
            { upsert: true }
        );
        return serialize(record);
    }

    // ==================== 修改开始 ====================
    async checkVectorSearch () {
        // 1. 检查 chunks 是否有数据
        const chunkCount = await this.db.collection('chunks').countDocuments();
        if (chunkCount === 0) {
            return {
                ok: false,
                error: 'chunks collection is empty. Please sync project knowledge first.',
                chunkCount: 0
            };
        }

        // 2. 检查是否有 embedding 字段
        const sampleChunk = await this.db.collection('chunks').findOne(
            {
                embedding: { $exists: true, $type: 'array', $ne: [] },
                tenantId: { $exists: true, $type: 'string', $ne: '' },
                scopes: { $exists: true, $type: 'array', $ne: [] }
            },
            { projection: { embedding: 1, tenantId: 1, scopes: 1 } }
        );
        if (!sampleChunk) {
            return {
                ok: false,
                error: 'No chunks with embedding field found.',
                chunkCount
            };
        }

        // 3. 检查维度
        const actualDimensions = sampleChunk.embedding.length;
        if (actualDimensions !== config.ragVectorDimensions) {
            return {
                ok: false,
                error: `Embedding dimension mismatch: index expects ${config.ragVectorDimensions} but chunk has ${actualDimensions}.`,
                chunkCount,
                actualDimensions,
                expectedDimensions: config.ragVectorDimensions
            };
        }

        // 4. 用真实 chunk 的 embedding 探测
        try {
            const result = await this.db.collection('chunks').aggregate([
                {
                    $vectorSearch: {
                        index: config.ragVectorIndex,
                        path: config.ragVectorPath,
                        queryVector: sampleChunk.embedding,
                        numCandidates: Math.min(chunkCount, 16),
                        limit: 1,
                        filter: {
                            $and: [
                                { tenantId: { $eq: sampleChunk.tenantId } },
                                { scopes: { $in: sampleChunk.scopes } }
                            ]
                        }
                    }
                },
                { $project: { _id: 1, content: 1, vectorScore: { $meta: 'vectorSearchScore' } } }
            ]).toArray();

            return {
                ok: true,
                live: true,
                sampleCount: result.length,
                sampleScore: result[0]?.vectorScore,
                chunkCount,
                dimensions: actualDimensions
            };
        } catch (error) {
            return {
                ok: false,
                live: false,
                error: error.message,
                errorCode: error.code,
                chunkCount,
                dimensions: actualDimensions,
                indexName: config.ragVectorIndex
            };
        }
    }
    // ==================== 修改结束 ====================

    async createTask (task) {
        const result = await this.db.collection('tasks').insertOne({ ...task, createdAt: now(), updatedAt: now() });
        return serialize(await this.db.collection('tasks').findOne({ _id: result.insertedId }));
    }

    async updateTask (id, patch) {
        await this.db
            .collection('tasks')
            .updateOne({ _id: new ObjectId(id) }, { $set: { ...patch, updatedAt: now() } });
        return serialize(await this.db.collection('tasks').findOne({ _id: new ObjectId(id) }));
    }

    async getTask (id) {
        return serialize(await this.db.collection('tasks').findOne({ _id: new ObjectId(id) }));
    }

    async listTasks () {
        const tasks = await this.db.collection('tasks').find().sort({ createdAt: -1 }).limit(50).toArray();
        return tasks.map(serialize);
    }

    async createTelemetry (event) {
        const result = await this.db.collection('telemetry').insertOne({ ...event, createdAt: now() });
        return serialize(await this.db.collection('telemetry').findOne({ _id: result.insertedId }));
    }

    async listTelemetry (limit = 50) {
        const events = await this.db.collection('telemetry').find().sort({ createdAt: -1 }).limit(limit).toArray();
        return events.map(serialize);
    }

    async createRecord (collection, payload) {
        const result = await this.db.collection(collection).insertOne({ ...payload, createdAt: now(), updatedAt: now() });
        return serialize(await this.db.collection(collection).findOne({ _id: result.insertedId }));
    }

    async listRecords (collection, limit = 100, projection = null, context = null) {
        const options = projection ? { projection } : {};
        const query = context ? tenantUserFilter(context) : {};   // 无 context 时保持旧行为（仅用于内部脚本）
        const records = await this.db.collection(collection)
            .find(query, options)
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();
        return records.map(serialize);
    }

    // 增加按 context 过滤，否则详情接口仍需在路由层校验
    async getRecord (collection, id, context = null) {
        const filter = { _id: new ObjectId(id) };
        if (context) {
            Object.assign(filter, tenantUserFilter(context));
        }
        return serialize(await this.db.collection(collection).findOne(filter));
    }

    async updateRecord (collection, id, patch, context = null) {
        const filter = { _id: new ObjectId(id) };
        if (context) {
            Object.assign(filter, tenantUserFilter(context));
        }
        await this.db
            .collection(collection)
            .updateOne(filter, { $set: { ...patch, updatedAt: now() } });
        return serialize(await this.db.collection(collection).findOne(filter));
    }

    async compareAndSetRecord (collection, id, expectedVersion, patch) {
        const filter = { _id: new ObjectId(id), version: Number(expectedVersion) };
        const result = await this.db.collection(collection).updateOne(
            filter,
            { $set: { ...patch, updatedAt: now() } }
        );
        if (result.modifiedCount !== 1) return null;
        return serialize(await this.db.collection(collection).findOne({ _id: new ObjectId(id) }));
    }
}
