import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cosineSimilarity, embedText, keywordOverlap } from '../utils/embedding.js';
import { hashPassword } from '../utils/password.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'demo-db.json');
const DEMO_ADMIN_PASSWORD_HASH = hashPassword('removed-public-password', 'aidemo-local-demo-admin');

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

function createDemoAdmin() {
  return {
    _id: crypto.randomUUID(),
    name: 'AI Copilot 管理员',
    email: 'removed-default-admin@example.invalid',
    role: 'ai_copilot_admin',
    department: 'AI 产品研发',
    passwordHash: DEMO_ADMIN_PASSWORD_HASH,
    createdAt: now()
  };
}

async function ensureDemoAdmin(db) {
  db.users = Array.isArray(db.users) ? db.users : [];
  const existing = db.users.find((user) => user.email === 'removed-default-admin@example.invalid');
  if (existing) {
    const next = {
      name: 'AI Copilot 管理员',
      role: 'ai_copilot_admin',
      department: 'AI 产品研发',
      passwordHash: DEMO_ADMIN_PASSWORD_HASH
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
  }

  async init() {
    const db = await readDb();
    let changed = false;

    changed = await ensureDemoAdmin(db) || changed;

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

  async createDocumentInMemory(db, { title, content, tags = [], sourceType = 'manual', sourcePath, sourceUpdatedAt }) {
    const docId = crypto.randomUUID();
    const document = {
      _id: docId,
      title,
      content,
      tags,
      sourceType,
      sourcePath,
      sourceUpdatedAt,
      chunkCount: 0,
      createdAt: now()
    };

    const { splitIntoChunks } = await import('../utils/embedding.js');
    const chunks = splitIntoChunks(content).map((chunk, index) => ({
      _id: crypto.randomUUID(),
      documentId: docId,
      documentTitle: title,
      tags,
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

  async findUserByEmail(email) {
    const db = await readDb();
    if (await ensureDemoAdmin(db)) await writeDb(db);
    return db.users.find((user) => user.email === email) || null;
  }

  async findUserById(id) {
    const db = await readDb();
    if (await ensureDemoAdmin(db)) await writeDb(db);
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
