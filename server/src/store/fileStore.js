import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cosineSimilarity, embedText, keywordOverlap } from '../utils/embedding.js';
import { hashPassword } from '../utils/password.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'demo-db.json');

const seedDocs = [
  {
    title: '会员增长活动方法论',
    tags: ['growth', 'campaign'],
    content:
      '会员增长活动应围绕目标人群、权益刺激、渠道触达、转化路径和复购承接设计。高价值用户适合会员日和专属券，新用户适合首单礼和限时补贴，沉睡用户适合召回券和内容种草。核心指标包括曝光、点击、领取、核销、GMV、ROI 和次日留存。'
  },
  {
    title: '投放素材生产规范',
    tags: ['creative', 'ads'],
    content:
      '投放素材需要明确人群痛点、利益点、行动指令和可信背书。短视频首 3 秒突出场景冲突，信息流图片控制在一个主卖点。A/B 测试至少覆盖标题、利益点、视觉风格和 CTA。素材复盘关注 CTR、CVR、CPA、ROI 和疲劳衰减。'
  },
  {
    title: '运营 Agent 工具边界',
    tags: ['agent', 'workflow'],
    content:
      '运营 Agent 可以自动生成方案、查询知识库、生成素材、读取归因数据、创建优惠券草稿和 Push 草稿。涉及真实预算消耗、用户触达、广告发布、券生效等动作必须进入人工确认。所有工具调用需要记录输入、输出、状态和回滚策略。'
  }
];

async function readDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    return JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
  } catch {
    return { users: [], documents: [], chunks: [], tasks: [], telemetry: [] };
  }
}

async function writeDb(db) {
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

function now() {
  return new Date().toISOString();
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

export class FileStore {
  constructor() {
    this.kind = 'file';
  }

  async init() {
    const db = await readDb();
    let changed = false;

    if (!db.users.some((user) => user.email === 'admin@growth.ai')) {
      db.users.push({
        _id: crypto.randomUUID(),
        name: '增长平台管理员',
        email: 'admin@growth.ai',
        role: 'growth_admin',
        department: '用户增长',
        passwordHash: hashPassword('demo123456'),
        createdAt: now()
      });
      changed = true;
    }

    if (!db.documents.length) {
      for (const doc of seedDocs) {
        const created = await this.createDocumentInMemory(db, doc);
        db.documents.push(created.document);
        db.chunks.push(...created.chunks);
      }
      changed = true;
    }

    if (changed) await writeDb(db);
  }

  async createDocumentInMemory(db, { title, content, tags = [] }) {
    const docId = crypto.randomUUID();
    const document = {
      _id: docId,
      title,
      content,
      tags,
      chunkCount: 0,
      createdAt: now()
    };

    const { splitIntoChunks } = await import('../utils/embedding.js');
    const chunks = splitIntoChunks(content).map((chunk, index) => ({
      _id: crypto.randomUUID(),
      documentId: docId,
      documentTitle: title,
      content: chunk,
      chunkIndex: index,
      embedding: embedText(chunk),
      createdAt: now()
    }));

    document.chunkCount = chunks.length;
    return { document, chunks };
  }

  async findUserByEmail(email) {
    const db = await readDb();
    return db.users.find((user) => user.email === email) || null;
  }

  async findUserById(id) {
    const db = await readDb();
    return publicUser(db.users.find((user) => user._id === id));
  }

  async createDocument(payload) {
    const db = await readDb();
    const created = await this.createDocumentInMemory(db, payload);
    db.documents.unshift(created.document);
    db.chunks.push(...created.chunks);
    await writeDb(db);
    return created.document;
  }

  async listDocuments() {
    const db = await readDb();
    return db.documents;
  }

  async searchChunks(question, limit = 5) {
    const db = await readDb();
    const queryEmbedding = embedText(question);
    return db.chunks
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

  async createTask(task) {
    const db = await readDb();
    const created = { _id: crypto.randomUUID(), ...task, createdAt: now(), updatedAt: now() };
    db.tasks.unshift(created);
    await writeDb(db);
    return created;
  }

  async updateTask(id, patch) {
    const db = await readDb();
    const index = db.tasks.findIndex((task) => task._id === id);
    if (index === -1) return null;
    db.tasks[index] = { ...db.tasks[index], ...patch, updatedAt: now() };
    await writeDb(db);
    return db.tasks[index];
  }

  async getTask(id) {
    const db = await readDb();
    return db.tasks.find((task) => task._id === id) || null;
  }

  async listTasks() {
    const db = await readDb();
    return db.tasks.slice(0, 50);
  }

  async createTelemetry(event) {
    const db = await readDb();
    const created = { _id: crypto.randomUUID(), ...event, createdAt: now() };
    db.telemetry = db.telemetry || [];
    db.telemetry.unshift(created);
    db.telemetry = db.telemetry.slice(0, 500);
    await writeDb(db);
    return created;
  }

  async listTelemetry(limit = 50) {
    const db = await readDb();
    return (db.telemetry || []).slice(0, limit);
  }

  async createRecord(collection, payload) {
    const db = await readDb();
    db[collection] = db[collection] || [];
    const created = { _id: crypto.randomUUID(), ...payload, createdAt: now(), updatedAt: now() };
    db[collection].unshift(created);
    await writeDb(db);
    return created;
  }

  async listRecords(collection, limit = 100) {
    const db = await readDb();
    return (db[collection] || []).slice(0, limit);
  }

  async getRecord(collection, id) {
    const db = await readDb();
    return (db[collection] || []).find((item) => item._id === id) || null;
  }

  async updateRecord(collection, id, patch) {
    const db = await readDb();
    db[collection] = db[collection] || [];
    const index = db[collection].findIndex((item) => item._id === id);
    if (index === -1) return null;
    db[collection][index] = { ...db[collection][index], ...patch, updatedAt: now() };
    await writeDb(db);
    return db[collection][index];
  }
}
