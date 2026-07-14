import { MongoClient, ObjectId } from 'mongodb';
import { config } from '../config.js';
import { cosineSimilarity, embedText, keywordOverlap, splitIntoChunks } from '../utils/embedding.js';
import { hashPassword } from '../utils/password.js';

function now() {
  return new Date();
}

function serialize(document) {
  if (!document) return null;
  return { ...document, _id: String(document._id) };
}

export class MongoStore {
  constructor(uri) {
    this.uri = uri;
    this.kind = 'mongo';
  }

  async init() {
    this.client = new MongoClient(this.uri, { serverSelectionTimeoutMS: 1800 });
    await this.client.connect();
    this.db = this.client.db();

    await this.db.collection('users').createIndex({ email: 1 }, { unique: true });
    await this.db.collection('chunks').createIndex({ documentId: 1 });
    await this.db.collection('chunks').createIndex({ tags: 1 });
    await this.db.collection('tasks').createIndex({ createdAt: -1 });
    await this.db.collection('telemetry').createIndex({ createdAt: -1 });
    await this.db.collection('telemetry').createIndex({ traceId: 1 });
    await this.ensureVectorIndex();

    await this.seed();
  }

  async ensureVectorIndex() {
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
              path: 'tags'
            }
          ]
        }
      });
      console.log(`[rag] requested MongoDB Atlas Vector Search index: ${config.ragVectorIndex}`);
    } catch (error) {
      console.warn(`[rag] skip vector index creation: ${error.message}`);
    }
  }

  async seed() {
    const users = this.db.collection('users');
    const existingUser = await users.findOne({ email: 'admin@growth.ai' });
    if (!existingUser) {
      await users.insertOne({
        name: '增长平台管理员',
        email: 'admin@growth.ai',
        role: 'growth_admin',
        department: '用户增长',
        passwordHash: hashPassword('demo123456'),
        createdAt: now()
      });
    }

    const documentsCount = await this.db.collection('documents').countDocuments();
    if (documentsCount === 0) {
      await this.createDocument({
        title: '会员增长活动方法论',
        tags: ['growth', 'campaign'],
        content:
          '会员增长活动应围绕目标人群、权益刺激、渠道触达、转化路径和复购承接设计。高价值用户适合会员日和专属券，新用户适合首单礼和限时补贴，沉睡用户适合召回券和内容种草。核心指标包括曝光、点击、领取、核销、GMV、ROI 和次日留存。'
      });
      await this.createDocument({
        title: '投放素材生产规范',
        tags: ['creative', 'ads'],
        content:
          '投放素材需要明确人群痛点、利益点、行动指令和可信背书。短视频首 3 秒突出场景冲突，信息流图片控制在一个主卖点。A/B 测试至少覆盖标题、利益点、视觉风格和 CTA。素材复盘关注 CTR、CVR、CPA、ROI 和疲劳衰减。'
      });
      await this.createDocument({
        title: '运营 Agent 工具边界',
        tags: ['agent', 'workflow'],
        content:
          '运营 Agent 可以自动生成方案、查询知识库、生成素材、读取归因数据、创建优惠券草稿和 Push 草稿。涉及真实预算消耗、用户触达、广告发布、券生效等动作必须进入人工确认。所有工具调用需要记录输入、输出、状态和回滚策略。'
      });
    }
  }

  async findUserByEmail(email) {
    return this.db.collection('users').findOne({ email });
  }

  async findUserById(id) {
    const user = await this.db.collection('users').findOne({ _id: new ObjectId(id) });
    if (!user) return null;
    const { passwordHash, ...safeUser } = user;
    return serialize(safeUser);
  }

  async createDocument({ title, content, tags = [] }) {
    const chunks = splitIntoChunks(content);
    const document = {
      title,
      content,
      tags,
      chunkCount: chunks.length,
      createdAt: now()
    };
    const result = await this.db.collection('documents').insertOne(document);
    const inserted = { ...document, _id: result.insertedId };

    if (chunks.length) {
      await this.db.collection('chunks').insertMany(
        chunks.map((chunk, index) => ({
          documentId: result.insertedId,
          documentTitle: title,
          tags,
          content: chunk,
          chunkIndex: index,
          embedding: embedText(chunk),
          createdAt: now()
        }))
      );
    }

    return serialize(inserted);
  }

  async listDocuments() {
    const docs = await this.db.collection('documents').find().sort({ createdAt: -1 }).toArray();
    return docs.map(serialize);
  }

  async searchChunks(question, limit = 5) {
    const chunks = await this.db.collection('chunks').find().toArray();
    const queryEmbedding = embedText(question);
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

  async searchVectorChunks(question, { scopes = [], limit = 5, numCandidates = 80 } = {}) {
    const queryEmbedding = embedText(question);
    const pipeline = [
      {
        $vectorSearch: {
          index: config.ragVectorIndex,
          path: config.ragVectorPath,
          queryVector: queryEmbedding,
          numCandidates: Math.max(numCandidates, limit * 8),
          limit: Math.max(limit * 3, limit)
        }
      },
      {
        $project: {
          documentId: 1,
          documentTitle: 1,
          tags: 1,
          content: 1,
          chunkIndex: 1,
          createdAt: 1,
          vectorScore: { $meta: 'vectorSearchScore' }
        }
      }
    ];

    const chunks = await this.db.collection('chunks').aggregate(pipeline).toArray();
    const allowedScopes = new Set([...scopes, 'copilot']);
    const filtered = chunks.filter((chunk) => {
      const tags = chunk.tags || [];
      return !tags.length || tags.some((tag) => allowedScopes.has(tag));
    });

    return (filtered.length ? filtered : chunks).slice(0, limit).map((chunk) => serialize({
      ...chunk,
      documentId: String(chunk.documentId),
      score: Number((chunk.vectorScore || 0).toFixed(4)),
      retrievalBackend: 'mongodb-atlas-vector-search'
    }));
  }

  async createTask(task) {
    const result = await this.db.collection('tasks').insertOne({ ...task, createdAt: now(), updatedAt: now() });
    return serialize(await this.db.collection('tasks').findOne({ _id: result.insertedId }));
  }

  async updateTask(id, patch) {
    await this.db
      .collection('tasks')
      .updateOne({ _id: new ObjectId(id) }, { $set: { ...patch, updatedAt: now() } });
    return serialize(await this.db.collection('tasks').findOne({ _id: new ObjectId(id) }));
  }

  async getTask(id) {
    return serialize(await this.db.collection('tasks').findOne({ _id: new ObjectId(id) }));
  }

  async listTasks() {
    const tasks = await this.db.collection('tasks').find().sort({ createdAt: -1 }).limit(50).toArray();
    return tasks.map(serialize);
  }

  async createTelemetry(event) {
    const result = await this.db.collection('telemetry').insertOne({ ...event, createdAt: now() });
    return serialize(await this.db.collection('telemetry').findOne({ _id: result.insertedId }));
  }

  async listTelemetry(limit = 50) {
    const events = await this.db.collection('telemetry').find().sort({ createdAt: -1 }).limit(limit).toArray();
    return events.map(serialize);
  }

  async createRecord(collection, payload) {
    const result = await this.db.collection(collection).insertOne({ ...payload, createdAt: now(), updatedAt: now() });
    return serialize(await this.db.collection(collection).findOne({ _id: result.insertedId }));
  }

  async listRecords(collection, limit = 100) {
    const records = await this.db.collection(collection).find().sort({ createdAt: -1 }).limit(limit).toArray();
    return records.map(serialize);
  }

  async getRecord(collection, id) {
    return serialize(await this.db.collection(collection).findOne({ _id: new ObjectId(id) }));
  }

  async updateRecord(collection, id, patch) {
    await this.db
      .collection(collection)
      .updateOne({ _id: new ObjectId(id) }, { $set: { ...patch, updatedAt: now() } });
    return serialize(await this.db.collection(collection).findOne({ _id: new ObjectId(id) }));
  }
}
