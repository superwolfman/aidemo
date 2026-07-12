import crypto from 'node:crypto';
import express from 'express';
import { closeSse, initSse, sendEvent, sleep } from '../utils/sse.js';

const skills = [
  {
    id: 'requirement-analysis',
    name: '需求分析 Skill',
    version: '1.0.0',
    description: '把业务输入拆成目标、约束、风险、验收标准和待确认问题。',
    systemPrompt: '你是资深架构需求分析师，必须输出结构化需求分析，标出不确定项和验收标准。',
    inputSchema: {
      type: 'object',
      required: ['businessGoal', 'constraints'],
      properties: {
        businessGoal: { type: 'string', minLength: 10 },
        constraints: { type: 'array', items: { type: 'string' } }
      }
    },
    outputSchema: {
      type: 'object',
      required: ['summary', 'acceptanceCriteria', 'risks', 'openQuestions'],
      properties: {
        summary: { type: 'string' },
        acceptanceCriteria: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } },
        openQuestions: { type: 'array', items: { type: 'string' } }
      }
    },
    allowedTools: ['searchKnowledge'],
    knowledgeScopes: ['standards', 'sdk', 'architecture']
  },
  {
    id: 'architecture-review',
    name: '架构评审 Skill',
    version: '1.0.0',
    description: '审查前端架构、BFF、RAG、Agent、可观测性和发布风险。',
    systemPrompt: '你是企业级前端架构评审专家，必须基于引用资料和工程约束给出可执行评审意见。',
    inputSchema: {
      type: 'object',
      required: ['proposal', 'targetSystem'],
      properties: {
        proposal: { type: 'string' },
        targetSystem: { type: 'string' }
      }
    },
    outputSchema: {
      type: 'object',
      required: ['decision', 'tradeoffs', 'guardrails', 'nextActions'],
      properties: {
        decision: { type: 'string', enum: ['approve', 'revise', 'reject'] },
        tradeoffs: { type: 'array', items: { type: 'string' } },
        guardrails: { type: 'array', items: { type: 'string' } },
        nextActions: { type: 'array', items: { type: 'string' } }
      }
    },
    allowedTools: ['searchKnowledge', 'analyzeRepository', 'generateArchitectureDocument'],
    knowledgeScopes: ['architecture', 'micro-frontend', 'im', 'lowcode']
  },
  {
    id: 'code-review',
    name: '代码审查 Skill',
    version: '1.0.0',
    description: '面向 PR 的代码审查，关注风险、测试、性能、可维护性和工程规范。',
    systemPrompt: '你是严谨的 Code Review Agent，先给风险，再给建议，必须指出测试缺口。',
    inputSchema: {
      type: 'object',
      required: ['diffSummary', 'riskLevel'],
      properties: {
        diffSummary: { type: 'string' },
        riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] }
      }
    },
    outputSchema: {
      type: 'object',
      required: ['findings', 'testGaps', 'recommendation'],
      properties: {
        findings: { type: 'array', items: { type: 'string' } },
        testGaps: { type: 'array', items: { type: 'string' } },
        recommendation: { type: 'string' }
      }
    },
    allowedTools: ['analyzeRepository', 'searchKnowledge'],
    knowledgeScopes: ['standards', 'sdk']
  }
];

const seedKnowledge = [
  {
    title: '微前端架构设计文档',
    tags: ['copilot', 'architecture', 'micro-frontend'],
    content:
      '微前端基座需要统一登录态、路由、生命周期、全局事件和灰度发布。Wujie 适合 iframe + WebComponent 沙箱隔离，Qiankun 适合存量生态成熟场景。子应用必须通过 manifest 声明 domain、capabilities、entry 和权限边界。'
  },
  {
    title: 'SDK 规范与工程约束',
    tags: ['copilot', 'sdk', 'standards'],
    content:
      '@company/sdk 必须提供类型定义、错误码、超时、重试、缓存、降级和埋点。禁止在业务模块中直接调用不受控全局变量。CI 需要检查硬编码、翻译覆盖率、类型错误和构建产物大小。'
  },
  {
    title: 'IM 架构文档',
    tags: ['copilot', 'im', 'architecture'],
    content:
      '在线 IM 使用 WebSocket 承载实时消息，后端需要会话 ID、用户 ID、消息持久化、机器人接待、转人工、重连补偿和审计。高风险内容需要进入人工确认节点，不能由 Agent 自动执行。'
  },
  {
    title: '低代码组件协议',
    tags: ['copilot', 'lowcode', 'architecture'],
    content:
      '低代码编辑器应采用块式 Document Model，节点和边与渲染层解耦。核心机制包括 Schema、Plugin、Selection、History、Command、Transaction、离线 opLog 和协同合并。'
  },
  {
    title: '项目开发规范',
    tags: ['copilot', 'standards'],
    content:
      '前端必须使用 TypeScript 和 Less，模块需要拆分清晰，公共能力进入 platform。Node BFF 负责鉴权、RAG、工具调用、会话和 Trace。高风险工具必须通过人工确认。'
  }
];

function now() {
  return new Date().toISOString();
}

function tokenCount(text) {
  return Math.max(12, Math.ceil(String(text || '').length / 1.8));
}

function step(id, name, status, extra = {}) {
  return {
    id,
    name,
    status,
    durationMs: 80 + Math.floor(Math.random() * 180),
    tokenUsage: extra.tokenUsage || 0,
    humanRequired: Boolean(extra.humanRequired),
    ...extra
  };
}

async function ensureKnowledge(store) {
  const docs = await store.listDocuments();
  const titles = new Set(docs.map((doc) => doc.title));
  for (const doc of seedKnowledge) {
    if (!titles.has(doc.title)) await store.createDocument(doc);
  }
}

async function searchKnowledge(store, query, scopes) {
  const chunks = await store.searchChunks(`${query} ${scopes.join(' ')}`, 8);
  const filtered = chunks.filter((chunk) => {
    const tags = chunk.tags || [];
    return !tags.length || tags.some((tag) => scopes.includes(tag) || tag === 'copilot');
  });
  return (filtered.length ? filtered : chunks).slice(0, 5);
}

async function analyzeRepository() {
  return {
    stack: ['React', 'TypeScript', 'Less', 'Node.js', 'MongoDB', 'WebSocket', 'SSE'],
    modules: ['copilot', 'skills', 'knowledge', 'trace', 'human-review'],
    risks: ['缺少真实 LLM Provider 时需要 mock provider 边界', 'PDF 文本抽取在 MVP 中采用轻量兼容策略'],
    recommendation: '保持工具接口稳定，后续可替换为 MCP Server 或 OpenAI Agents SDK tools。'
  };
}

function generateArchitectureDocument({ prompt, skill, sources }) {
  return `# AI Architecture Copilot 架构建议

## 目标
${prompt}

## Skill
- ${skill.name} / ${skill.version}
- Knowledge scopes: ${skill.knowledgeScopes.join(', ')}
- Allowed tools: ${skill.allowedTools.join(', ')}

## 建议架构
1. 使用多会话 Chat 作为入口，所有生成过程进入 Agent Trace。
2. Skill Runtime 根据输入 Schema 校验用户请求，并约束输出 Schema。
3. RAG 根据 Skill 的 knowledgeScopes 选择知识范围，并在回答中展示引用来源。
4. Tool Calling 统一封装 searchKnowledge、analyzeRepository、generateArchitectureDocument。
5. 写文档、改配置、发请求等高风险动作进入人工确认节点。

## 引用来源
${sources.map((source, index) => `${index + 1}. ${source.documentTitle || source.title} / score ${source.score ?? '-'}`).join('\n')}

## 下一步
- 用户确认或修改架构建议后，再执行最终文档生成。
- 若拒绝，则保留 Trace 和原因用于复盘。`;
}

function buildAnswer({ prompt, skill, sources, repoAnalysis }) {
  const sourceText = sources.map((source, index) => `[${index + 1}] ${source.documentTitle}: ${source.content}`).join('\n');
  return `## ${skill.name} 输出

我会按 **${skill.description}** 处理你的请求。

### 结构化结论
- 目标：${prompt}
- 决策：建议先进入 **revise / human-confirmed** 状态，再生成最终架构文档。
- 关键约束：Skill 输入 Schema、输出 Schema、allowedTools、knowledgeScopes 都需要进入运行时审计。

### 工具结果
- searchKnowledge 命中 ${sources.length} 条上下文。
- analyzeRepository 识别技术栈：${repoAnalysis.stack.join(' / ')}。
- generateArchitectureDocument 已生成草稿，等待人工确认。

### 代码示例
\`\`\`ts
type SkillDefinition = {
  id: string;
  name: string;
  systemPrompt: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  allowedTools: string[];
  knowledgeScopes: string[];
};
\`\`\`

### 引用来源
${sourceText || '暂无引用。'}`;
}

export function copilotRouter(store) {
  const router = express.Router();

  router.use(async (req, res, next) => {
    await ensureKnowledge(store);
    next();
  });

  router.get('/skills', (req, res) => {
    res.json({ skills });
  });

  router.get('/sessions', async (req, res) => {
    const sessions = await store.listRecords('copilot_sessions', 50);
    res.json({ sessions });
  });

  router.post('/sessions', async (req, res) => {
    const session = await store.createRecord('copilot_sessions', {
      title: req.body.title || '新的架构会话',
      messages: [],
      createdBy: req.user._id,
      activeSkillId: req.body.skillId || 'architecture-review'
    });
    res.json({ session });
  });

  router.get('/sessions/:id', async (req, res) => {
    const session = await store.getRecord('copilot_sessions', req.params.id);
    res.json({ session });
  });

  router.post('/knowledge/upload', async (req, res) => {
    const { filename, content, mimeType, scopes = ['architecture'] } = req.body;
    const extension = String(filename || '').split('.').pop()?.toLowerCase();
    const normalizedType = extension === 'pdf' ? 'pdf' : extension === 'md' || extension === 'markdown' ? 'markdown' : 'txt';
    const text =
      normalizedType === 'pdf' && !content
        ? `PDF 文档 ${filename} 已上传。MVP 模式记录文件元数据；生产环境接入 PDF parser 后抽取正文。`
        : content;
    const document = await store.createDocument({
      title: filename || `architecture-note-${Date.now()}.${normalizedType}`,
      tags: ['copilot', normalizedType, ...scopes],
      content: text || '空文档'
    });
    res.json({ document });
  });

  router.get('/knowledge', async (req, res) => {
    const documents = (await store.listDocuments()).filter((doc) => (doc.tags || []).includes('copilot'));
    res.json({ documents });
  });

  router.post('/sessions/:id/messages/stream', async (req, res) => {
    initSse(res);
    const session = await store.getRecord('copilot_sessions', req.params.id);
    if (!session) {
      sendEvent(res, 'error', { message: 'Session not found' });
      res.end();
      return;
    }

    const prompt = String(req.body.prompt || '').trim();
    const skill = skills.find((item) => item.id === req.body.skillId) || skills[1];
    const traceId = `trace-${crypto.randomUUID()}`;
    const userMessage = { id: `user-${Date.now()}`, role: 'user', content: prompt, createdAt: now(), skillId: skill.id };

    const trace = [];
    const emitStep = async (payload) => {
      trace.push(payload);
      sendEvent(res, 'trace', payload);
      await sleep(120);
    };

    await emitStep(step('request', '用户请求', 'success', { input: { prompt }, tokenUsage: tokenCount(prompt) }));
    await emitStep(step('skill', '选择 Skill', 'success', { output: { id: skill.id, version: skill.version } }));
    await emitStep(step('context', '加载上下文', 'running', { output: { knowledgeScopes: skill.knowledgeScopes } }));
    const sources = await searchKnowledge(store, prompt, skill.knowledgeScopes);
    await emitStep(step('knowledge', '调用知识库 searchKnowledge', 'success', {
      tool: 'searchKnowledge',
      input: { query: prompt, scopes: skill.knowledgeScopes },
      output: sources.map((source) => ({ title: source.documentTitle, score: source.score })),
      tokenUsage: tokenCount(JSON.stringify(sources))
    }));
    sendEvent(res, 'sources', { sources });

    const repoAnalysis = await analyzeRepository();
    await emitStep(step('repo', '调用工具 analyzeRepository', 'success', {
      tool: 'analyzeRepository',
      input: { repository: 'local-workspace' },
      output: repoAnalysis,
      tokenUsage: 128
    }));

    const documentDraft = generateArchitectureDocument({ prompt, skill, sources });
    await emitStep(step('document', '调用工具 generateArchitectureDocument', 'success', {
      tool: 'generateArchitectureDocument',
      input: { format: 'markdown', requireCitations: true },
      output: { chars: documentDraft.length },
      tokenUsage: tokenCount(documentDraft)
    }));

    const answer = buildAnswer({ prompt, skill, sources, repoAnalysis });
    await emitStep(step('structured', '生成结构化结果', 'success', { tokenUsage: tokenCount(answer) }));
    await emitStep(step('human', '等待人工确认', 'waiting', { humanRequired: true }));

    const assistantId = `assistant-${Date.now()}`;
    for (let index = 0; index < answer.length; index += 18) {
      sendEvent(res, 'delta', { id: assistantId, text: answer.slice(index, index + 18) });
      await sleep(18);
    }

    const approval = await store.createRecord('copilot_approvals', {
      traceId,
      sessionId: req.params.id,
      status: 'pending',
      skillId: skill.id,
      prompt,
      documentDraft
    });
    sendEvent(res, 'approval', { approval });

    const assistantMessage = {
      id: assistantId,
      role: 'assistant',
      content: answer,
      sources,
      trace,
      approvalId: approval._id,
      createdAt: now(),
      skillId: skill.id
    };
    const messages = [...(session.messages || []), userMessage, assistantMessage];
    await store.updateRecord('copilot_sessions', req.params.id, {
      messages,
      title: session.title === '新的架构会话' ? prompt.slice(0, 28) || session.title : session.title,
      activeSkillId: skill.id
    });

    sendEvent(res, 'final', { message: assistantMessage, traceId });
    closeSse(res);
  });

  router.post('/approvals/:id/:action', async (req, res) => {
    const approval = await store.getRecord('copilot_approvals', req.params.id);
    if (!approval) {
      res.status(404).json({ message: 'Approval not found' });
      return;
    }

    const action = req.params.action;
    const status = action === 'confirm' ? 'confirmed' : action === 'reject' ? 'rejected' : 'revised';
    const finalDocument = action === 'revise' && req.body.revision ? req.body.revision : approval.documentDraft;
    const updated = await store.updateRecord('copilot_approvals', req.params.id, {
      status,
      finalDocument,
      reviewerNote: req.body.note || '',
      reviewedAt: now()
    });
    res.json({ approval: updated });
  });

  return router;
}
