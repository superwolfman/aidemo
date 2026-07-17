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

function inferIntent(input) {
  const text = String(input || '');
  if (/客服|知识库|问答|FAQ|答案|引用/.test(text)) {
    return {
      id: 'knowledge-assistant',
      label: '知识库问答与运营纠错',
      goal: '从知识库中检索可信上下文，输出带引用答案、缺口和人工纠错建议。',
      scopes: ['architecture', 'standards', 'ai-native', 'im'],
      riskLevel: 'medium'
    };
  }
  if (/测试|质量|发布|上线|验收|回归|门禁/.test(text)) {
    return {
      id: 'delivery-review-agent',
      label: '交付质量评审',
      goal: '评估方案完整度、测试缺口、上线风险和人工确认项。',
      scopes: ['standards', 'architecture', 'sdk'],
      riskLevel: 'high'
    };
  }
  if (/接口|页面|PRD|原型|任务|流程|产品|工作流|需求/.test(text)) {
    return {
      id: 'product-delivery-agent',
      label: 'AI 产品交付工作流',
      goal: '把需求转成 PRD、页面结构、API Contract、研发任务和测试策略。',
      scopes: ['architecture', 'standards', 'ai-native', 'frontend'],
      riskLevel: 'high'
    };
  }
  return {
    id: 'product-delivery-agent',
    label: '通用产研测交付',
    goal: '先澄清需求，再生成可评审交付物和下一步动作。',
    scopes: ['architecture', 'standards', 'ai-native'],
    riskLevel: 'medium'
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
    const review = await store.createRecord('agent_reviews', {
      runId: run._id,
      action: req.body.action || 'confirm',
      note: req.body.note || '',
      reviewerId: req.user._id
    });
    const nextRun = await store.updateRecord('agent_runs', run._id, {
      status: req.body.action === 'reject' ? 'rejected' : 'confirmed',
      review
    });
    res.json({ review, run: nextRun });
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
      rollback: 'rolled_back'
    };
    const status = statusMap[action] || 'paused';
    const log = auditLog('control', `运行控制动作：${action}`, {
      action,
      operatorId: req.user._id,
      reason: req.body.reason || ''
    });
    const nextRun = await store.updateRecord('agent_runs', run._id, {
      status,
      controlState: {
        action,
        status,
        reason: req.body.reason || '',
        updatedAt: now(),
        operatorId: req.user._id
      },
      logs: [...(run.logs || []), log]
    });
    res.json({ run: nextRun, log });
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
    const modelConfig = req.body.model && typeof req.body.model === 'object' ? req.body.model : {};
    const provider = getProviderStatus(modelConfig);
    const intent = inferIntent(prompt);
    const selectedSkill = selectCapability(intent);
    let plan = buildAgentPlan(intent);
    const runId = `run-${crypto.randomUUID()}`;
    const logs = [
      auditLog('info', 'Agent Run 已创建', { runId, promptPreview: prompt.slice(0, 80) })
    ];
    const trace = [];
    const emitStatus = (status, label, extra = {}) => sendEvent(res, 'run_status', { status, label, at: now(), ...extra });
    const emitStep = async (payload) => {
      trace.push(payload);
      sendEvent(res, 'trace', payload);
      await sleep(110);
    };

    emitStatus('intent_detected', '识别自然语言意图', { runId, intent, selectedSkill, plan });
    await emitStep(step('intent', '意图理解', 'success', {
      input: { prompt },
      output: intent,
      tokenUsage: tokenCount(prompt)
    }));
    logs.push(auditLog('info', `意图识别完成：${intent.label}`, { intent }));

    plan = updatePlan(plan, 'select-skill', 'success', { output: { skillId: selectedSkill.id, tools: selectedSkill.tools } });
    sendEvent(res, 'plan', { plan, selectedSkill, intent });
    await emitStep(step('skill', 'Skill 自动选择', 'success', {
      input: { intent: intent.id },
      output: selectedSkill,
      tokenUsage: tokenCount(JSON.stringify(selectedSkill))
    }));
    logs.push(auditLog('info', `自动选择 Skill：${selectedSkill.name}`, { skillId: selectedSkill.id }));

    emitStatus('retrieving', '检索知识库上下文', { scopes: intent.scopes });
    const retrievalStartedAt = Date.now();
    const rag = await retrieveKnowledge({ store, query: `${intent.goal}\n${prompt}`, scopes: intent.scopes, limit: 5 });
    const sources = rag.sources || [];
    sendEvent(res, 'sources', { sources, rag: rag.status, latencyMs: Date.now() - retrievalStartedAt, scopes: intent.scopes });
    plan = updatePlan(plan, 'retrieve-context', 'success', { output: { hits: sources.length, backend: rag.status?.retrievalBackend || rag.status?.backend } });
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

    emitStatus('planning', '规划产研测交付路径');
    const artifacts = buildDeliveryArtifacts({ intent, prompt, sources });
    plan = updatePlan(plan, 'run-tools', 'success', { output: { artifacts: artifacts.map((artifact) => artifact.type) } });
    sendEvent(res, 'plan', { plan, selectedSkill, intent });
    await emitStep(step('plan', '产研测计划生成', 'success', {
      tool: 'planDelivery',
      output: { artifacts: artifacts.map((artifact) => artifact.title), riskLevel: intent.riskLevel },
      tokenUsage: tokenCount(JSON.stringify(artifacts))
    }));
    sendEvent(res, 'artifacts', { artifacts });
    logs.push(auditLog('tool', `工具生成 ${artifacts.length} 个 Artifact`, {
      tool: 'planDelivery',
      artifacts: artifacts.map((artifact) => artifact.title)
    }));

    emitStatus('streaming', '调用 LLM Provider 流式生成');
    plan = updatePlan(plan, 'stream-result', 'running');
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
    } catch (error) {
      await emitStep(step('llm', 'LLM 流式生成', 'failed', { error: error.message }));
      answer = `${fallback}\n\n### Provider fallback\n真实模型调用失败，已降级到 deterministic Agent Runtime。错误：${error.message}`;
      plan = updatePlan(plan, 'stream-result', 'failed', { error: error.message });
      logs.push(auditLog('error', 'LLM Provider 调用失败，已降级 fallback', { error: error.message }));
    }
    sendEvent(res, 'plan', { plan, selectedSkill, intent });

    if (!streamed) {
      for (let index = 0; index < answer.length; index += 20) {
        sendEvent(res, 'delta', { text: answer.slice(index, index + 20) });
        await sleep(14);
      }
    }

    emitStatus('review_required', '等待人工确认');
    plan = updatePlan(plan, 'human-review', 'waiting', { output: { humanRequired: intent.riskLevel === 'high' } });
    sendEvent(res, 'plan', { plan, selectedSkill, intent });
    await emitStep(step('review', '人工确认节点', 'waiting', {
      humanRequired: intent.riskLevel === 'high',
      output: { policy: '高风险交付物需确认后进入执行' }
    }));
    logs.push(auditLog('review', '进入人工确认节点', { humanRequired: intent.riskLevel === 'high' }));

    const run = await store.createRecord('agent_runs', {
      runId,
      sessionId: session._id,
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
    emitStatus('completed', 'Agent 运行完成，等待交付确认');
    sendEvent(res, 'final', { run, message: assistantMessage });
    closeSse(res);
  });

  return router;
}
