import crypto from 'node:crypto';
import express from 'express';
import { generateLlmAnswer, getProviderStatus, streamLlmAnswer } from '../services/llmProvider.js';
import { getRagStatus, retrieveKnowledge } from '../services/ragEngine.js';
import { closeSse, initSse, sendEvent, sleep } from '../utils/sse.js';

const agentCapabilities = [
  {
    id: 'product-delivery-agent',
    name: '产研测交付 Agent',
    description: '把自然语言需求转成 PRD、页面方案、接口契约、测试策略和发布清单。',
    intents: ['需求澄清', '页面方案', '接口协同', '研发任务拆解', '测试与发布'],
    tools: ['detectIntent', 'retrieveKnowledge', 'planDelivery', 'generateArtifacts', 'requestHumanReview']
  },
  {
    id: 'knowledge-assistant',
    name: '知识库问答 Agent',
    description: '围绕项目规范、AI Native 交互、RAG 与前端工程约束回答问题并给出引用。',
    intents: ['知识问答', '规范查询', '方案解释', '风险提示'],
    tools: ['detectIntent', 'retrieveKnowledge', 'answerWithCitations']
  },
  {
    id: 'delivery-review-agent',
    name: '交付评审 Agent',
    description: '审查产物完整度、接口合理性、测试缺口、风险和人工确认项。',
    intents: ['方案评审', '测试缺口', '上线风险', '质量门禁'],
    tools: ['detectIntent', 'retrieveKnowledge', 'reviewArtifacts', 'requestHumanReview']
  }
];

function now() {
  return new Date().toISOString();
}

function tokenCount(text) {
  return Math.max(10, Math.ceil(String(text || '').length / 1.8));
}

function step(id, name, status, extra = {}) {
  return {
    id,
    name,
    status,
    durationMs: 70 + Math.floor(Math.random() * 160),
    tokenUsage: extra.tokenUsage || 0,
    at: now(),
    ...extra
  };
}

function auditLog(level, message, extra = {}) {
  return {
    id: `log-${crypto.randomUUID()}`,
    level,
    message,
    at: now(),
    ...extra
  };
}

const runStateTransitions = {
  created: ['intent_detected', 'failed', 'cancelled', 'paused'],
  intent_detected: ['skill_selected', 'failed', 'cancelled', 'paused'],
  skill_selected: ['retrieving', 'failed', 'cancelled', 'paused'],
  retrieving: ['tool_running', 'failed', 'cancelled', 'paused'],
  tool_running: ['streaming', 'failed', 'cancelled', 'paused'],
  streaming: ['review_required', 'failed', 'cancelled', 'paused'],
  review_required: ['confirmed', 'rejected', 'revision_requested', 'paused'],
  revision_requested: ['tool_running', 'cancelled', 'paused'],
  paused: ['resumed', 'cancelled', 'rolled_back'],
  resumed: ['review_required', 'tool_running', 'streaming', 'failed', 'paused', 'confirmed', 'rejected', 'revision_requested'],
  rolled_back: ['revision_requested', 'cancelled'],
  failed: ['resumed', 'rolled_back', 'cancelled'],
  confirmed: [],
  rejected: [],
  cancelled: []
};

function canTransition(from, to) {
  if (from === to) return true;
  return (runStateTransitions[from] || []).includes(to);
}

function createStateTransition({ from, to, label, actorId, reason = '', meta = {} }) {
  return {
    id: `transition-${crypto.randomUUID()}`,
    from,
    to,
    label,
    actorId,
    reason,
    at: now(),
    meta
  };
}

function transitionRunPatch(run, to, { label, actorId, reason = '', meta = {} } = {}) {
  const from = run.status || 'created';
  if (!canTransition(from, to)) {
    const message = `Invalid Agent Run transition: ${from} -> ${to}`;
    const error = new Error(message);
    error.statusCode = 409;
    throw error;
  }
  const transition = createStateTransition({ from, to, label: label || to, actorId, reason, meta });
  return {
    status: to,
    stateTransitions: [...(run.stateTransitions || []), transition]
  };
}

function upsertTraceStage(trace = [], stageId, patch = {}) {
  let updated = false;
  const nextTrace = trace.map((item) => {
    if (item.id !== stageId) return item;
    updated = true;
    return {
      ...item,
      ...patch,
      updatedAt: now()
    };
  });
  if (!updated) {
    nextTrace.push(step(stageId, patch.name || stageId, patch.status || 'success', patch));
  }
  return nextTrace;
}

function inferIntent(input) {
  const text = String(input || '');
  const signals = [];
  if (/客服|知识库|问答|FAQ|答案|引用/.test(text)) {
    signals.push('knowledge', 'qa', 'citation');
    return {
      id: 'knowledge-assistant',
      label: '知识库问答与运营纠错',
      goal: '从知识库中检索可信上下文，输出带引用答案、缺口和人工纠错建议。',
      scopes: ['architecture', 'standards', 'ai-native', 'im'],
      riskLevel: 'medium',
      confidence: 0.86,
      signals
    };
  }
  if (/测试|质量|发布|上线|验收|回归|门禁/.test(text)) {
    signals.push('quality', 'release', 'review');
    return {
      id: 'delivery-review-agent',
      label: '交付质量评审',
      goal: '评估方案完整度、测试缺口、上线风险和人工确认项。',
      scopes: ['standards', 'architecture', 'sdk'],
      riskLevel: 'high',
      confidence: 0.88,
      signals
    };
  }
  if (/接口|页面|PRD|原型|任务|流程|产品|工作流|需求/.test(text)) {
    signals.push('product', 'workflow', 'prd', 'api');
    return {
      id: 'product-delivery-agent',
      label: 'AI 产品交付工作流',
      goal: '把需求转成 PRD、页面结构、API Contract、研发任务和测试策略。',
      scopes: ['architecture', 'standards', 'ai-native', 'frontend'],
      riskLevel: 'high',
      confidence: 0.92,
      signals
    };
  }
  return {
    id: 'product-delivery-agent',
    label: '通用产研测交付',
    goal: '先澄清需求，再生成可评审交付物和下一步动作。',
    scopes: ['architecture', 'standards', 'ai-native'],
    riskLevel: 'medium',
    confidence: 0.62,
    signals: ['general']
  };
}

function selectCapability(intent) {
  return agentCapabilities.find((capability) => capability.id === intent.id) || agentCapabilities[0];
}

function buildAgentPlan(intent) {
  return [
    {
      id: 'validate-request',
      name: '校验用户请求',
      owner: 'Runtime',
      status: 'success',
      guardrail: '检查输入是否可执行、是否需要人工澄清',
      tool: 'validateInput'
    },
    {
      id: 'select-skill',
      name: '选择 Skill',
      owner: 'Skill Runtime',
      status: 'success',
      guardrail: '根据意图映射 allowedTools 与 knowledgeScopes',
      tool: 'selectSkill'
    },
    {
      id: 'retrieve-context',
      name: '检索上下文',
      owner: 'RAG Engine',
      status: 'pending',
      guardrail: `限定 scopes: ${intent.scopes.join(', ')}`,
      tool: 'retrieveKnowledge'
    },
    {
      id: 'run-tools',
      name: '执行工具',
      owner: 'Tool Runtime',
      status: 'pending',
      guardrail: '只允许当前 Skill 声明的工具执行',
      tool: 'planDelivery'
    },
    {
      id: 'stream-result',
      name: '流式生成',
      owner: 'LLM Provider',
      status: 'pending',
      guardrail: 'Provider fallback 必须显式展示',
      tool: 'streamLlmAnswer'
    },
    {
      id: 'human-review',
      name: '人工审批',
      owner: 'Reviewer',
      status: intent.riskLevel === 'high' ? 'waiting' : 'pending',
      guardrail: '高风险动作必须暂停等待确认',
      tool: 'requestHumanReview'
    }
  ];
}

function updatePlan(plan, id, status, patch = {}) {
  return plan.map((item) => item.id === id ? { ...item, status, ...patch } : item);
}

function buildDeliveryArtifacts({ intent, prompt, sources }) {
  const citations = sources.map((source, index) => `[${index + 1}] ${source.documentTitle} · score ${Number(source.score || 0).toFixed(4)}`);
  const sourceBlock = citations.length ? citations.join('\n') : '当前没有命中引用，建议补充业务文档或项目规范。';
  const base = {
    goal: intent.goal,
    sourceCount: sources.length,
    riskLevel: intent.riskLevel
  };

  return [
    {
      id: `agent-artifact-prd-${crypto.randomUUID()}`,
      type: 'prd',
      title: `${intent.label} PRD 摘要`,
      status: 'draft',
      content: [
        `# ${intent.label} PRD 摘要`,
        '',
        `## 用户输入`,
        prompt,
        '',
        `## 产品目标`,
        `- ${intent.goal}`,
        '- 通过自然语言交互完成需求澄清、上下文检索、产物生成和人工确认。',
        '- 输出内容必须可引用、可追踪、可复盘。',
        '',
        '## 核心用户',
        '- 产品经理：输入需求并确认 PRD 方向。',
        '- 前端工程师：评审页面结构、状态流和交互细节。',
        '- 后端工程师：评审 BFF API、数据模型和权限边界。',
        '- 测试工程师：评审测试策略、验收标准和回归范围。',
        '',
        '## 引用依据',
        sourceBlock
      ].join('\n')
    },
    {
      id: `agent-artifact-flow-${crypto.randomUUID()}`,
      type: 'flow',
      title: '页面与状态流',
      status: 'draft',
      content: {
        ...base,
        pages: [
          { name: '自然语言输入区', modules: ['任务输入', '意图识别', '上下文范围', '模型状态'] },
          { name: 'Agent 执行区', modules: ['流式输出', '工具调用', '引用来源', '失败重试'] },
          { name: '交付物区', modules: ['PRD', '页面结构', 'API Contract', '测试计划', '发布清单'] },
          { name: '审计区', modules: ['Trace 时间线', 'Token/耗时', '人工确认', '审批历史'] }
        ],
        states: ['idle', 'intent_detected', 'retrieving', 'planning', 'streaming', 'review_required', 'completed']
      }
    },
    {
      id: `agent-artifact-api-${crypto.randomUUID()}`,
      type: 'api',
      title: 'BFF API Contract',
      status: 'draft',
      content: {
        'POST /api/agent-studio/sessions/:id/runs/stream': {
          request: { message: 'string', agentId: intent.id, model: 'optional provider config' },
          responseEvents: ['run_status', 'trace', 'sources', 'artifact', 'delta', 'review', 'final']
        },
        'GET /api/agent-studio/runs/:id': {
          response: ['status', 'intent', 'trace', 'sources', 'artifacts', 'review']
        },
        guardrails: ['高风险工具必须人工确认', '所有关键结论需要 citation', '失败必须可重试并保留 Trace']
      }
    },
    {
      id: `agent-artifact-test-${crypto.randomUUID()}`,
      type: 'test',
      title: '测试与验收策略',
      status: 'draft',
      content: [
        '# 测试与验收策略',
        '',
        '- 意图识别：同一需求不同表达应映射到稳定 Agent 类型。',
        '- RAG：引用来源必须包含 chunk、score、sourcePath 和 retrievalBackend。',
        '- SSE：覆盖流式输出、中断、重试、Provider fallback。',
        '- Artifact：PRD、Flow、API、Test Plan 均可预览、复制、导出和确认。',
        '- Human-in-the-loop：高风险节点必须暂停并记录审批结果。'
      ].join('\n')
    },
    {
      id: `agent-artifact-risk-${crypto.randomUUID()}`,
      type: 'risk',
      title: '风险与人工确认问题',
      status: 'draft',
      content: [
        '# 风险与人工确认问题',
        '',
        '## 主要风险',
        '- LLM Provider 失败时必须显式进入 fallback，并保留审计记录。',
        '- RAG 命中不足时，生成结果必须标记为低置信度，不能伪造引用。',
        '- API Contract、页面状态流和测试策略需要人工确认后才能进入交付。',
        '',
        '## 待确认问题',
        '- 目标用户与权限边界是否清晰？',
        '- 是否允许 Agent 自动触发外部系统写入？',
        '- 是否需要把审批结果同步到研发任务系统？',
        '',
        '## 引用依据',
        sourceBlock
      ].join('\n')
    }
  ];
}

function normalizeSourceRef(source, index) {
  return {
    id: source._id || `source-${index + 1}`,
    index: index + 1,
    title: source.documentTitle,
    score: Number(source.score || 0),
    retrievalBackend: source.retrievalBackend,
    sourcePath: source.sourcePath
  };
}

function attachArtifactWorkflow(artifacts, traceStepId = 'tool', sources = []) {
  const sourceRefs = sources.map(normalizeSourceRef);
  return artifacts.map((artifact) => ({
    ...artifact,
    status: artifact.status || 'draft',
    version: 1,
    traceStepId,
    generatedBy: {
      tool: 'planDelivery',
      traceStepId,
      generatedAt: now()
    },
    sourceRefs,
    sourceIds: sourceRefs.map((source) => source.id),
    reviewStatus: 'pending',
    versions: [
      {
        version: 1,
        status: 'created',
        content: artifact.content,
        createdAt: now()
      }
    ],
    approvals: [],
    exports: []
  }));
}

function scoreRunQuality({ sources = [], artifacts = [], trace = [], provider = {}, intent = {} }) {
  const hasPrd = artifacts.some((artifact) => artifact.type === 'prd');
  const hasApi = artifacts.some((artifact) => artifact.type === 'api');
  const hasFlow = artifacts.some((artifact) => artifact.type === 'flow');
  const hasTask = artifacts.some((artifact) => artifact.type === 'task' || artifact.type === 'test');
  const hasRisk = artifacts.some((artifact) => artifact.type === 'risk');
  const traceReplayable = trace.length >= 6 && trace.every((item) => item.id && item.name && item.status);
  const citationScores = sources.map((source) => Number(source.score || 0));
  const avgCitationScore = citationScores.length
    ? Number((citationScores.reduce((sum, value) => sum + value, 0) / citationScores.length).toFixed(4))
    : 0;
  const checks = [
    { key: 'citation', label: '引用来源命中', passed: sources.length > 0, value: `${sources.length} chunks` },
    { key: 'prd', label: 'PRD 完整度', passed: hasPrd, value: hasPrd ? 'ready' : 'missing' },
    { key: 'api', label: 'API Contract 合理性', passed: hasApi, value: hasApi ? 'ready' : 'missing' },
    { key: 'flow', label: '页面 / 状态结构', passed: hasFlow, value: hasFlow ? 'ready' : 'missing' },
    { key: 'task', label: '任务拆解', passed: hasTask, value: hasTask ? 'ready' : 'missing' },
    { key: 'risk', label: '风险与人工确认', passed: hasRisk || intent.riskLevel === 'high', value: intent.riskLevel || 'unknown' },
    { key: 'trace', label: 'Trace 可复盘', passed: traceReplayable, value: `${trace.length} steps` },
    { key: 'provider', label: 'Provider 状态透明', passed: Boolean(provider.provider && provider.mode), value: `${provider.provider || 'unknown'} / ${provider.mode || 'unknown'}` }
  ];
  const passed = checks.filter((item) => item.passed).length;
  return {
    score: Math.round((passed / checks.length) * 100),
    passed,
    total: checks.length,
    avgCitationScore,
    checks,
    verdict:
      passed === checks.length
        ? 'ready_for_review'
        : passed >= Math.ceil(checks.length * 0.7)
          ? 'needs_minor_review'
          : 'needs_revision'
  };
}

async function persistEvalResult(store, run) {
  const quality = run.quality || scoreRunQuality(run);
  const result = await store.createRecord('agent_eval_results', {
    runId: run._id,
    evalCaseId: run.evalCaseId || null,
    score: quality.score,
    passed: quality.passed,
    total: quality.total,
    verdict: quality.verdict,
    checks: quality.checks,
    citationHitCount: run.sources?.length || 0,
    artifactCount: run.artifacts?.length || 0,
    traceStepCount: run.trace?.length || 0,
    createdAt: now()
  });
  return result;
}

function buildEvalCases() {
  return [
    {
      id: 'ai-product-workflow',
      title: 'AI 产品工作流',
      prompt: '为企业内部 AI 产品研发团队建设一个需求到交付 Copilot 工作台，要求覆盖 PRD、页面结构、接口协议、研发任务和人工确认。',
      expected: ['引用来源命中', 'PRD 完整度', 'API Contract 合理性', 'Trace 可复盘']
    },
    {
      id: 'customer-knowledge-base',
      title: '智能客服知识库',
      prompt: '建设智能客服知识库助手，支持文档上传、问题检索、答案引用、人工纠错、会话历史和知识命中质量评估。',
      expected: ['知识库范围清楚', '页面结构覆盖会话与引用', 'API 包含检索和反馈', '风险包含幻觉治理']
    },
    {
      id: 'research-report-workbench',
      title: '投研报告生成工作台',
      prompt: '建设投研报告生成工作台，支持上传资料、检索公司和行业知识、生成报告大纲、输出章节草稿、展示引用来源并进入合规复核。',
      expected: ['业务边界明确', '页面结构覆盖资料/生成/审阅', '接口协议有审计字段', 'Trace 支持合规复核']
    }
  ];
}

function buildFallbackAnswer({ prompt, intent, sources, artifacts }) {
  const citationText = sources.map((source, index) => `- [${index + 1}] ${source.documentTitle}：${String(source.content || '').slice(0, 120)}`).join('\n');
  return [
    `## ${intent.label}`,
    '',
    `我已识别到你的目标是：${intent.goal}`,
    '',
    '### 执行路径',
    '- 识别自然语言意图，并选择合适 Agent。',
    '- 根据 Agent scopes 检索知识库上下文。',
    '- 生成 PRD、页面结构、接口协议和测试策略。',
    '- 高风险输出进入人工确认，保留 Trace 可审计链路。',
    '',
    '### 本次产物',
    ...artifacts.map((artifact) => `- ${artifact.title}（${artifact.type}）`),
    '',
    '### 引用来源',
    citationText || '- 暂无引用来源，需要补充知识库文档。'
  ].join('\n');
}

function normalizeSession(session) {
  if (!session) return session;
  return {
    ...session,
    messages: Array.isArray(session.messages) ? session.messages.filter((item) => item?.content) : []
  };
}

export function agentStudioRouter(store) {
  const router = express.Router();

  router.get('/blueprint', (req, res) => {
    res.json({
      capabilities: agentCapabilities,
      architecture: {
        frontend: ['Agent Runtime Console', 'Run Queue', 'Intent Inspector', 'Plan Board', 'State Machine', 'Tool Calls', 'Audit Timeline'],
        bff: ['Auth', 'Session', 'Agent Run State', 'RAG Retrieval', 'Tool Runtime', 'LLM Provider Adapter', 'Human Review', 'Audit Log'],
        states: ['idle', 'intent_detected', 'skill_selected', 'retrieving', 'tool_running', 'streaming', 'review_required', 'paused', 'resumed', 'rolled_back', 'confirmed', 'failed', 'cancelled'],
        data: ['agent_sessions', 'agent_runs', 'agent_reviews', 'agent_audit_logs']
      },
      controls: {
        supportedActions: ['pause', 'resume', 'rollback', 'confirm', 'revise', 'reject'],
        policy: '高风险工具和外部写入动作必须 human-in-the-loop；运行控制动作写入 audit log。'
      },
      runtime: {
        llm: getProviderStatus(),
        rag: getRagStatus({ storeKind: store.kind, error: store.connectionError })
      }
    });
  });

  router.get('/sessions', async (req, res) => {
    const sessions = await store.listRecords('agent_sessions', 50);
    res.json({ sessions: sessions.map(normalizeSession) });
  });

  router.get('/runs', async (req, res) => {
    const runs = await store.listRecords('agent_runs', 50);
    res.json({ runs });
  });

  router.get('/eval-cases', async (req, res) => {
    const runs = await store.listRecords('agent_runs', 100);
    const evalResults = await store.listRecords('agent_eval_results', 100);
    res.json({
      cases: buildEvalCases().map((item) => ({
        ...item,
        status: 'ready',
        lastRunId: runs.find((run) => run.evalCaseId === item.id)?._id,
        lastResult: runs.find((run) => run.evalCaseId === item.id)?.quality,
        evalHistory: evalResults.filter((result) => result.evalCaseId === item.id).slice(0, 5)
      }))
    });
  });

  router.post('/sessions', async (req, res) => {
    const session = await store.createRecord('agent_sessions', {
      title: req.body.title || '新的 Agent 会话',
      createdBy: req.user._id,
      activeAgentId: req.body.agentId || 'product-delivery-agent',
      messages: []
    });
    res.json({ session: normalizeSession(session) });
  });

  router.get('/runs/:id', async (req, res) => {
    const run = await store.getRecord('agent_runs', req.params.id);
    if (!run) {
      res.status(404).json({ message: 'Agent run not found' });
      return;
    }
    res.json({ run });
  });

  router.post('/runs/:id/review', async (req, res) => {
    const run = await store.getRecord('agent_runs', req.params.id);
    if (!run) {
      res.status(404).json({ message: 'Agent run not found' });
      return;
    }
    const action = req.body.action || 'confirm';
    const nextStatusMap = {
      confirm: 'confirmed',
      reject: 'rejected',
      revise: 'revision_requested'
    };
    const nextStatus = nextStatusMap[action] || 'confirmed';
    const review = await store.createRecord('agent_reviews', {
      runId: run._id,
      action,
      note: req.body.note || '',
      reviewerId: req.user._id,
      previousStatus: run.status,
      nextStatus
    });
    const log = auditLog('review', `审批动作：${action}`, {
      action,
      reviewerId: req.user._id,
      note: req.body.note || ''
    });
    const nextArtifacts = action === 'confirm'
      ? (run.artifacts || []).map((artifact) => ({
        ...artifact,
        status: artifact.status === 'confirmed' ? artifact.status : 'reviewed',
        reviewStatus: artifact.reviewStatus === 'confirmed' ? artifact.reviewStatus : 'reviewed'
      }))
      : run.artifacts || [];
    const nextTrace = upsertTraceStage(run.trace || [], 'review', {
      name: '人工审批决策',
      status: action === 'reject' ? 'failed' : action === 'revise' ? 'waiting' : 'success',
      output: {
        action,
        note: req.body.note || '',
        policy: action === 'confirm' ? '审批通过，允许进入下一阶段' : '审批未通过，需要修订或终止'
      }
    });
    let transitionPatch;
    try {
      transitionPatch = transitionRunPatch(run, nextStatus, {
        label: `人工审批：${action}`,
        actorId: req.user._id,
        reason: req.body.note || ''
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ message: error.message });
      return;
    }
    const quality = scoreRunQuality({ ...run, artifacts: nextArtifacts, trace: nextTrace });
    const nextRun = await store.updateRecord('agent_runs', run._id, {
      ...transitionPatch,
      review,
      reviewHistory: [review, ...(run.reviewHistory || [])],
      artifacts: nextArtifacts,
      trace: nextTrace,
      quality,
      logs: [...(run.logs || []), log]
    });
    res.json({ review, run: nextRun });
  });

  router.patch('/runs/:id/artifacts/:artifactId', async (req, res) => {
    const run = await store.getRecord('agent_runs', req.params.id);
    if (!run) {
      res.status(404).json({ message: 'Agent run not found' });
      return;
    }
    const artifacts = (run.artifacts || []).map((artifact) => {
      if (artifact.id !== req.params.artifactId) return artifact;
      const version = Number(artifact.version || 1) + 1;
      const nextContent = req.body.content ?? artifact.content;
      const nextStatus = req.body.status || artifact.status || 'draft';
      return {
        ...artifact,
        content: nextContent,
        status: nextStatus,
        reviewStatus: req.body.reviewStatus || artifact.reviewStatus || 'pending',
        updatedAt: now(),
        updatedBy: req.user._id,
        version,
        versions: [
          {
            version,
            status: nextStatus,
            content: nextContent,
            createdAt: now(),
            operatorId: req.user._id
          },
          ...(artifact.versions || [])
        ].slice(0, 12)
      };
    });
    const updatedArtifact = artifacts.find((artifact) => artifact.id === req.params.artifactId);
    if (!updatedArtifact) {
      res.status(404).json({ message: 'Artifact not found' });
      return;
    }
    const log = auditLog('artifact', `Artifact 更新：${updatedArtifact.title}`, {
      artifactId: updatedArtifact.id,
      version: updatedArtifact.version,
      traceStepId: updatedArtifact.traceStepId,
      sourceIds: updatedArtifact.sourceIds || []
    });
    const nextRun = await store.updateRecord('agent_runs', run._id, {
      artifacts,
      logs: [...(run.logs || []), log],
      quality: scoreRunQuality({ ...run, artifacts })
    });
    res.json({ artifact: updatedArtifact, run: nextRun });
  });

  router.post('/runs/:id/artifacts/:artifactId/confirm', async (req, res) => {
    const run = await store.getRecord('agent_runs', req.params.id);
    if (!run) {
      res.status(404).json({ message: 'Agent run not found' });
      return;
    }
    const artifacts = (run.artifacts || []).map((artifact) => {
      if (artifact.id !== req.params.artifactId) return artifact;
      return {
        ...artifact,
        status: 'confirmed',
        reviewStatus: 'confirmed',
        confirmedAt: now(),
        confirmedBy: req.user._id,
        approvals: [
          { action: 'confirm', note: req.body.note || '', reviewerId: req.user._id, createdAt: now() },
          ...(artifact.approvals || [])
        ]
      };
    });
    const updatedArtifact = artifacts.find((artifact) => artifact.id === req.params.artifactId);
    if (!updatedArtifact) {
      res.status(404).json({ message: 'Artifact not found' });
      return;
    }
    const log = auditLog('artifact', `Artifact 确认：${updatedArtifact.title}`, { artifactId: updatedArtifact.id });
    const nextTrace = upsertTraceStage(run.trace || [], updatedArtifact.traceStepId || 'tool', {
      status: 'success',
      output: {
        ...(run.trace || []).find((item) => item.id === (updatedArtifact.traceStepId || 'tool'))?.output,
        confirmedArtifactId: updatedArtifact.id,
        confirmedArtifactTitle: updatedArtifact.title
      }
    });
    const nextRun = await store.updateRecord('agent_runs', run._id, {
      artifacts,
      trace: nextTrace,
      logs: [...(run.logs || []), log],
      quality: scoreRunQuality({ ...run, artifacts, trace: nextTrace })
    });
    res.json({ artifact: updatedArtifact, run: nextRun });
  });

  router.get('/runs/:id/artifacts/:artifactId/export', async (req, res) => {
    const run = await store.getRecord('agent_runs', req.params.id);
    const artifact = run?.artifacts?.find((item) => item.id === req.params.artifactId);
    if (!artifact) {
      res.status(404).json({ message: 'Artifact not found' });
      return;
    }
    const format = req.query.format === 'json' ? 'json' : 'markdown';
    const content = typeof artifact.content === 'string' ? artifact.content : JSON.stringify(artifact.content, null, 2);
    const exportRecord = {
      id: `export-${crypto.randomUUID()}`,
      format,
      filename: `${artifact.type}-${artifact.id}.${format === 'json' ? 'json' : 'md'}`,
      exportedAt: now(),
      exportedBy: req.user._id
    };
    const artifacts = (run.artifacts || []).map((item) => (
      item.id === artifact.id
        ? { ...item, exports: [exportRecord, ...(item.exports || [])].slice(0, 20) }
        : item
    ));
    const log = auditLog('artifact', `Artifact 导出：${artifact.title}`, {
      artifactId: artifact.id,
      format,
      filename: exportRecord.filename
    });
    const nextRun = await store.updateRecord('agent_runs', run._id, {
      artifacts,
      logs: [...(run.logs || []), log]
    });
    res.json({
      filename: `${artifact.type}-${artifact.id}.${format === 'json' ? 'json' : 'md'}`,
      format,
      run: nextRun,
      content: format === 'json'
        ? JSON.stringify(artifact, null, 2)
        : `# ${artifact.title}\n\n> version: ${artifact.version || 1} / status: ${artifact.status || 'draft'}\n\n${content}`
    });
  });

  router.post('/runs/:id/control', async (req, res) => {
    const run = await store.getRecord('agent_runs', req.params.id);
    if (!run) {
      res.status(404).json({ message: 'Agent run not found' });
      return;
    }
    const action = req.body.action || 'pause';
    const statusMap = {
      pause: 'paused',
      resume: 'resumed',
      rollback: 'rolled_back',
      cancel: 'cancelled'
    };
    const status = statusMap[action] || 'paused';
    let transitionPatch;
    try {
      transitionPatch = transitionRunPatch(run, status, {
        label: `运行控制：${action}`,
        actorId: req.user._id,
        reason: req.body.reason || ''
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ message: error.message });
      return;
    }
    const rollbackArtifacts = action === 'rollback'
      ? (run.artifacts || []).map((artifact) => {
        const previousVersion = (artifact.versions || [])[1] || (artifact.versions || [])[0];
        if (!previousVersion) return artifact;
        const version = Number(artifact.version || 1) + 1;
        return {
          ...artifact,
          content: previousVersion.content,
          status: 'rolled_back',
          reviewStatus: 'pending',
          version,
          versions: [
            {
              version,
              status: 'rolled_back',
              content: previousVersion.content,
              createdAt: now(),
              operatorId: req.user._id,
              rollbackFrom: artifact.version
            },
            ...(artifact.versions || [])
          ].slice(0, 12)
        };
      })
      : run.artifacts || [];
    const log = auditLog('control', `运行控制动作：${action}`, {
      action,
      operatorId: req.user._id,
      reason: req.body.reason || ''
    });
    const nextTrace = upsertTraceStage(run.trace || [], 'control', {
      name: '运行治理控制',
      status: action === 'rollback' ? 'warning' : 'success',
      input: { action, reason: req.body.reason || '' },
      output: { nextStatus: status, affectedArtifacts: rollbackArtifacts.length }
    });
    const quality = scoreRunQuality({ ...run, artifacts: rollbackArtifacts, trace: nextTrace });
    const nextRun = await store.updateRecord('agent_runs', run._id, {
      ...transitionPatch,
      controlState: {
        action,
        status,
        reason: req.body.reason || '',
        updatedAt: now(),
        operatorId: req.user._id,
        previousStatus: run.status
      },
      controlHistory: [
        {
          id: `control-${crypto.randomUUID()}`,
          action,
          status,
          reason: req.body.reason || '',
          operatorId: req.user._id,
          createdAt: now()
        },
        ...(run.controlHistory || [])
      ],
      artifacts: rollbackArtifacts,
      trace: nextTrace,
      quality,
      logs: [...(run.logs || []), log]
    });
    res.json({ run: nextRun, log });
  });

  router.post('/eval-cases/:id/score', async (req, res) => {
    const runs = await store.listRecords('agent_runs', 100);
    const run = runs.find((item) => item.evalCaseId === req.params.id || item._id === req.body.runId);
    if (!run) {
      res.status(404).json({ message: 'No run found for eval case' });
      return;
    }
    const quality = scoreRunQuality(run);
    const evalResult = await persistEvalResult(store, { ...run, quality });
    const nextRun = await store.updateRecord('agent_runs', run._id, {
      quality,
      evalResult,
      logs: [...(run.logs || []), auditLog('eval', `Eval 质量评分：${quality.score}%`, { evalCaseId: req.params.id, quality })]
    });
    res.json({ run: nextRun, evalResult });
  });

  router.post('/sessions/:id/runs/stream', async (req, res) => {
    initSse(res);
    const session = await store.getRecord('agent_sessions', req.params.id);
    if (!session) {
      sendEvent(res, 'error', { message: 'Session not found' });
      closeSse(res);
      return;
    }

    const prompt = String(req.body.message || '').trim();
    const commandOptions = req.body.commandOptions && typeof req.body.commandOptions === 'object' ? req.body.commandOptions : {};
    const modelConfig = req.body.model && typeof req.body.model === 'object' ? req.body.model : {};
    const provider = getProviderStatus(modelConfig);
    let intent = inferIntent(prompt);
    if (Array.isArray(commandOptions.scopes) && commandOptions.scopes.length) {
      intent = { ...intent, scopes: commandOptions.scopes };
    }
    const requestedCapability = agentCapabilities.find((capability) => (
      capability.id === commandOptions.agentId || capability.id === commandOptions.skillId
    ));
    const selectedSkill = requestedCapability || selectCapability(intent);
    if (requestedCapability && requestedCapability.id !== intent.id) {
      intent = {
        ...intent,
        id: requestedCapability.id,
        label: requestedCapability.name,
        goal: requestedCapability.description,
        signals: [...(intent.signals || []), 'command_center_selected']
      };
    }
    let plan = buildAgentPlan(intent);
    const runId = `run-${crypto.randomUUID()}`;
    const logs = [
      auditLog('info', 'Agent Run 已创建', { runId, promptPreview: prompt.slice(0, 80) })
    ];
    const trace = [];
    let runRecord = await store.createRecord('agent_runs', {
      runId,
      sessionId: session._id,
      status: 'created',
      prompt,
      intent,
      selectedSkill,
      plan,
      sources: [],
      artifacts: [],
      trace,
      logs,
      answer: '',
      provider,
      quality: null,
      evalCaseId: req.body.evalCaseId,
      commandOptions,
      createdBy: req.user._id,
      stateTransitions: [
        createStateTransition({
          from: 'none',
          to: 'created',
          label: '创建 Agent Run',
          actorId: req.user._id,
          meta: { sessionId: session._id }
        })
      ],
      reviewHistory: [],
      controlHistory: []
    });
    const persistRun = async (patch = {}) => {
      runRecord = await store.updateRecord('agent_runs', runRecord._id, {
        intent,
        selectedSkill,
        plan,
        trace,
        logs,
        ...patch
      });
      return runRecord;
    };
    const emitStatus = async (status, label, extra = {}) => {
      let transitionPatch;
      try {
        transitionPatch = transitionRunPatch(runRecord, status, {
          label,
          actorId: req.user._id,
          meta: extra
        });
      } catch (error) {
        transitionPatch = { status };
        logs.push(auditLog('error', error.message, { from: runRecord.status, to: status }));
      }
      await persistRun(transitionPatch);
      sendEvent(res, 'run_status', { runDbId: runRecord._id, runId, status, label, at: now(), intent, selectedSkill, plan, ...extra });
    };
    const emitStep = async (payload) => {
      trace.push(payload);
      await persistRun({ trace });
      sendEvent(res, 'trace', payload);
      await sleep(110);
    };

    await emitStatus('intent_detected', '识别自然语言意图', { runId, intent, selectedSkill, plan });
    await emitStep(step('intent', '意图理解', 'success', {
      input: { prompt },
      output: intent,
      tokenUsage: tokenCount(prompt)
    }));
    logs.push(auditLog('info', `意图识别完成：${intent.label}`, { intent }));
    await persistRun({ logs });

    plan = updatePlan(plan, 'select-skill', 'success', { output: { skillId: selectedSkill.id, tools: selectedSkill.tools } });
    await emitStatus('skill_selected', '选择 Agent Skill', { skillId: selectedSkill.id });
    await persistRun({ plan });
    sendEvent(res, 'plan', { plan, selectedSkill, intent });
    await emitStep(step('skill', 'Skill 自动选择', 'success', {
      input: { intent: intent.id },
      output: selectedSkill,
      tokenUsage: tokenCount(JSON.stringify(selectedSkill))
    }));
    logs.push(auditLog('info', `自动选择 Skill：${selectedSkill.name}`, { skillId: selectedSkill.id }));
    await persistRun({ logs });

    await emitStatus('retrieving', '检索知识库上下文', { scopes: intent.scopes });
    const retrievalStartedAt = Date.now();
    const rag = await retrieveKnowledge({ store, query: `${intent.goal}\n${prompt}`, scopes: intent.scopes, limit: 5 });
    const sources = rag.sources || [];
    sendEvent(res, 'sources', { sources, rag: rag.status, latencyMs: Date.now() - retrievalStartedAt, scopes: intent.scopes });
    plan = updatePlan(plan, 'retrieve-context', 'success', { output: { hits: sources.length, backend: rag.status?.retrievalBackend || rag.status?.backend } });
    await persistRun({ status: 'retrieving', sources, plan });
    sendEvent(res, 'plan', { plan, selectedSkill, intent });
    await emitStep(step('rag', 'RAG 上下文检索', 'success', {
      tool: 'retrieveKnowledge',
      input: { query: prompt, scopes: intent.scopes },
      output: sources.map((source) => ({ title: source.documentTitle, score: source.score, backend: source.retrievalBackend })),
      tokenUsage: tokenCount(JSON.stringify(sources))
    }));
    logs.push(auditLog('tool', `RAG 检索完成，命中 ${sources.length} 个 chunk`, {
      tool: 'retrieveKnowledge',
      hitCount: sources.length
    }));
    await persistRun({ logs, sources });

    await emitStatus('tool_running', '规划产研测交付路径');
    const artifacts = attachArtifactWorkflow(buildDeliveryArtifacts({ intent, prompt, sources }), 'tool', sources);
    plan = updatePlan(plan, 'run-tools', 'success', { output: { artifacts: artifacts.map((artifact) => artifact.type) } });
    await persistRun({ artifacts, plan });
    sendEvent(res, 'plan', { plan, selectedSkill, intent });
    await emitStep(step('tool', '产研测计划生成', 'success', {
      tool: 'planDelivery',
      output: {
        artifacts: artifacts.map((artifact) => ({ id: artifact.id, title: artifact.title, sourceIds: artifact.sourceIds })),
        riskLevel: intent.riskLevel,
        sourceRefs: sources.map(normalizeSourceRef)
      },
      tokenUsage: tokenCount(JSON.stringify(artifacts))
    }));
    sendEvent(res, 'artifacts', { artifacts });
    logs.push(auditLog('tool', `工具生成 ${artifacts.length} 个 Artifact`, {
      tool: 'planDelivery',
      artifacts: artifacts.map((artifact) => artifact.title)
    }));
    await persistRun({ logs, artifacts });

    await emitStatus('streaming', '调用 LLM Provider 流式生成');
    plan = updatePlan(plan, 'stream-result', 'running');
    await persistRun({ status: 'streaming', plan });
    sendEvent(res, 'plan', { plan, selectedSkill, intent });
    await emitStep(step('llm', 'LLM 流式生成', 'running', {
      input: { provider: provider.provider, model: provider.requestedModel || provider.model }
    }));

    const fallback = buildFallbackAnswer({ prompt, intent, sources, artifacts });
    let answer = fallback;
    let streamed = false;
    try {
      const generated = await streamLlmAnswer({
        systemPrompt: '你是企业级 AI Agent 产品专家，输出要围绕产研测交付闭环、自然语言交互、RAG 引用、Artifact、Trace 和人工确认。',
        prompt,
        sources,
        toolResults: { intent, artifacts: artifacts.map((artifact) => ({ type: artifact.type, title: artifact.title })) },
        modelConfig,
        onDelta: (text) => sendEvent(res, 'delta', { text })
      });
      if (generated.text?.trim()) {
        answer = generated.text;
        streamed = generated.streamed;
      } else {
        const completed = await generateLlmAnswer({
          systemPrompt: '你是企业级 AI Agent 产品专家。',
          prompt,
          sources,
          toolResults: { intent, artifacts },
          modelConfig,
          fallback
        });
        answer = completed.text;
      }
      await emitStep(step('llm', 'LLM 流式生成', 'success', {
        output: { mode: generated.provider.mode, streaming: generated.streamed },
        tokenUsage: tokenCount(answer)
      }));
      plan = updatePlan(plan, 'stream-result', 'success', { output: { provider: generated.provider.provider, model: generated.provider.model } });
      logs.push(auditLog('llm', 'LLM Provider 调用成功', { provider: generated.provider }));
      await persistRun({ answer, plan, logs, provider: generated.provider });
    } catch (error) {
      await emitStep(step('llm', 'LLM 流式生成', 'failed', { error: error.message }));
      answer = `${fallback}\n\n### Provider fallback\n真实模型调用失败，已降级到 deterministic Agent Runtime。错误：${error.message}`;
      plan = updatePlan(plan, 'stream-result', 'failed', { error: error.message });
      logs.push(auditLog('error', 'LLM Provider 调用失败，已降级 fallback', { error: error.message }));
      await persistRun({ answer, plan, logs, provider });
    }
    sendEvent(res, 'plan', { plan, selectedSkill, intent });

    if (!streamed) {
      for (let index = 0; index < answer.length; index += 20) {
        sendEvent(res, 'delta', { text: answer.slice(index, index + 20) });
        await sleep(14);
      }
    }

    await emitStatus('review_required', '等待人工确认');
    plan = updatePlan(plan, 'human-review', 'waiting', { output: { humanRequired: intent.riskLevel === 'high' } });
    await persistRun({ status: 'review_required', answer, plan });
    sendEvent(res, 'plan', { plan, selectedSkill, intent });
    await emitStep(step('review', '人工确认节点', 'waiting', {
      humanRequired: intent.riskLevel === 'high',
      output: { policy: '高风险交付物需确认后进入执行' }
    }));
    logs.push(auditLog('review', '进入人工确认节点', { humanRequired: intent.riskLevel === 'high' }));
    await persistRun({ logs });

    const quality = scoreRunQuality({ sources, artifacts, trace, provider, intent });
    const evalResult = await persistEvalResult(store, {
      ...runRecord,
      sources,
      artifacts,
      trace,
      provider,
      intent,
      quality,
      evalCaseId: req.body.evalCaseId
    });
    const run = await persistRun({
      status: 'review_required',
      prompt,
      intent,
      selectedSkill,
      plan,
      sources,
      artifacts,
      trace,
      logs,
      answer,
      provider,
      quality,
      evalResult,
      evalCaseId: req.body.evalCaseId,
      commandOptions,
      createdBy: req.user._id
    });
    const userMessage = { id: `user-${Date.now()}`, role: 'user', content: prompt, createdAt: now() };
    const assistantMessage = { id: `assistant-${Date.now()}`, role: 'assistant', content: answer, runId: run._id, sources, trace, createdAt: now() };
    const messages = [...(session.messages || []), userMessage, assistantMessage];
    await store.updateRecord('agent_sessions', session._id, {
      messages,
      activeAgentId: intent.id,
      title: session.title === '新的 Agent 会话' ? prompt.slice(0, 24) || session.title : session.title
    });

    sendEvent(res, 'review', { runId: run._id, required: intent.riskLevel === 'high', status: 'pending' });
    sendEvent(res, 'run_status', {
      runDbId: run._id,
      runId,
      status: 'completed',
      label: 'Agent 运行完成，等待交付确认',
      at: now(),
      intent,
      selectedSkill,
      plan
    });
    sendEvent(res, 'final', { run, message: assistantMessage });
    closeSse(res);
  });

  return router;
}
