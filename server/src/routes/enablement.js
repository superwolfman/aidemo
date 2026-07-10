import express from 'express';
import { aiService } from '../services/aiService.js';
import { closeSse, initSse, sendEvent, sleep } from '../utils/sse.js';

const terminalCards = [
  {
    id: 'pc',
    name: '员工 PC 展业后台',
    stack: 'React + Ant Design + SSE',
    status: 'running',
    scope: ['客户画像', '展业任务', '知识检索', '审批流', '运营看板']
  },
  {
    id: 'h5',
    name: '员工移动 H5',
    stack: 'React Responsive + WebView Bridge',
    status: 'running',
    scope: ['客户拜访', '资料转发', '会话助手', '离线缓存', '移动审批']
  },
  {
    id: 'wecom',
    name: '企业微信内嵌应用',
    stack: 'WeCom JS-SDK + OAuth + SSE',
    status: 'gray',
    scope: ['企微授权', '外部联系人', '智能问答', '群发素材', '会话记忆']
  }
];

const skills = [
  {
    id: 'customer-briefing',
    name: '客户拜访简报 Skill',
    trigger: '输入客户行业、阶段和拜访目标',
    tools: ['knowledge.retrieve', 'crm.profile', 'material.generate'],
    output: '拜访摘要、风险点、推荐话术、资料包'
  },
  {
    id: 'wecom-answer',
    name: '企微问答防幻觉 Skill',
    trigger: '企微内嵌助手问题',
    tools: ['rag.retrieve', 'rerank', 'citation.guard'],
    output: '带引用来源的回答、低置信度转人工'
  },
  {
    id: 'label-precheck',
    name: 'AI 辅助标注质检 Skill',
    trigger: '标注任务提交前',
    tools: ['model.prelabel', 'quality.rule', 'human.review'],
    output: '预标注结果、冲突项、审核建议'
  }
];

const specs = [
  {
    id: 'wecom-auth',
    title: '企微多端登录 Spec',
    status: 'approved',
    items: ['PC 账号密码登录', 'H5 token 静默续期', '企微 OAuth code 换用户身份', '同一员工 identity 归一']
  },
  {
    id: 'rag-guard',
    title: '知识库问答防幻觉 Spec',
    status: 'reviewing',
    items: ['回答必须带引用', '低置信度拒答', '敏感内容转人工', '会话上下文窗口裁剪']
  },
  {
    id: 'skill-standard',
    title: 'AI Skill 复用规范',
    status: 'draft',
    items: ['Skill 元数据', '输入输出 Schema', '工具权限', '审计日志', '灰度开关']
  }
];

const annotationTasks = [
  {
    id: 'task-1001',
    title: '车辆轨迹标注审核',
    vendor: '供应商 A',
    status: 'reviewing',
    progress: 78,
    quality: 96.2,
    aiSuggestion: '轨迹点 42-49 存在漂移，建议复核'
  },
  {
    id: 'task-1002',
    title: '路口车道线预标注',
    vendor: '供应商 B',
    status: 'labeling',
    progress: 54,
    quality: 91.4,
    aiSuggestion: '模型置信度 0.87，可进入人工抽检'
  },
  {
    id: 'task-1003',
    title: 'POI 标注质量抽检',
    vendor: '内部团队',
    status: 'done',
    progress: 100,
    quality: 98.1,
    aiSuggestion: '低风险，建议归档'
  }
];

const enablementDocuments = [
  {
    title: '企微内嵌应用授权与多端登录规范',
    tags: ['wecom', 'auth', 'terminal'],
    content:
      '企业微信内嵌应用登录链路为：前端通过企微 JS-SDK 获取 OAuth code，后端使用 corpId、agentId 和 secret 换取 wecomUserId，再通过身份中心映射到 employeeId。PC、H5、企微三端必须统一 employeeId，terminal 只作为终端来源字段。OAuth code 必须一次性消费，JWT 过期后需要静默续期。企微 JS-SDK config 签名按 URL 生成，需要缓存 ticket 并设置过期刷新。'
  },
  {
    title: '企微智能问答防幻觉与引用规范',
    tags: ['rag', 'guardrail', 'citation'],
    content:
      '企微智能问答必须先检索内部展业知识库。回答需要展示引用来源、更新时间和置信度。召回分数低于阈值时不能编造答案，应拒答、追问或转人工。涉及收益承诺、客户隐私、监管口径、内部敏感规则的问题必须转人工确认。会话记忆只用于理解上下文，不得替代知识库事实来源。'
  },
  {
    title: '员工展业话术与客户拜访简报规范',
    tags: ['sales', 'script', 'briefing'],
    content:
      '员工展业话术应包含客户当前场景、痛点确认、方案价值、引用依据和下一步动作。面向客户介绍数字化展业方案时，可以强调统一知识库、企微问答、资料包生成、客户跟进任务和数据留痕。禁止承诺收益或夸大效果。拜访结束后应生成客户摘要、风险点、推荐资料和跟进计划。'
  },
  {
    title: 'AI Skill 配置与复用操作手册',
    tags: ['skill', 'spec', 'tool'],
    content:
      'AI Skill 需要定义 id、名称、触发条件、输入 Schema、输出 Schema、工具链、权限、灰度范围和审计开关。Skill 执行必须记录输入、输出、工具调用顺序、员工身份、终端、traceId 和执行状态。客户拜访简报 Skill 可调用 knowledge.retrieve、crm.profile、material.generate。企微问答 Skill 必须调用 rag.retrieve、rerank、citation.guard。'
  },
  {
    title: 'AI 辅助标注与质检工作流规范',
    tags: ['annotation', 'quality', 'map'],
    content:
      'AI 辅助标注流程包括模型预标注、人工复核、供应商质量评分和结果回流。低置信度区域进入人工审核，轨迹漂移、遮挡、边界不清需要重点复核。质量看板应展示任务进度、供应商质量、缺陷分布和车辆轨迹回放。地图可视化生产环境可使用 OpenLayers 或 Leaflet，统计图表使用 ECharts。'
  },
  {
    title: '展业平台灰度发布与运维复盘规范',
    tags: ['ops', 'gray', 'trace'],
    content:
      'PC、H5、企微内嵌页需要统一发布版本和 traceId。灰度可按员工、部门、终端、企微 agentId 控制。监控指标包括登录失败率、SSE 断流率、RAG 无答案率、转人工率、Skill 执行失败率和平均响应耗时。故障复盘需要沉淀到内部知识库，形成后续问答和 Spec Coding 的依据。'
  }
];

function metrics() {
  return {
    terminals: 3,
    knowledgeDocs: 128,
    activeSessions: 42,
    skillRuns: 316,
    hallucinationRate: '1.8%',
    mttr: '8min',
    grayRelease: '20%',
    labelingEfficiency: '+37%'
  };
}

async function ensureSeeds(store) {
  const existing = await store.listRecords('enablement_specs', 1);
  if (!existing.length) {
    for (const spec of specs) await store.createRecord('enablement_specs', spec);
    for (const skill of skills) await store.createRecord('ai_skills', skill);
    for (const task of annotationTasks) await store.createRecord('annotation_tasks', task);
  }

  const documents = await store.listDocuments();
  for (const document of enablementDocuments) {
    if (!documents.some((item) => item.title === document.title)) {
      await store.createDocument(document);
    }
  }
}

export function enablementRouter(store) {
  const router = express.Router();

  router.use(async (req, res, next) => {
    await ensureSeeds(store);
    next();
  });

  router.get('/overview', async (req, res) => {
    res.json({
      product: 'Employee Enablement AI Platform',
      positioning: '员工展业三端 + 企微 AI 助手 + 内部知识库 RAG + AI Skill 编排 + 标注协同工作台',
      metrics: metrics(),
      architecture: [
        'React PC/H5/WeCom adaptive shell',
        'Node BFF demo layer, production can map to SpringBoot microservices',
        'MongoDB stores sessions, specs, skills, tasks and audit records',
        'SSE supports streaming QA and Agent execution events',
        'Spec Coding drives API, UI state, skill schema and rollout checklist'
      ]
    });
  });

  router.get('/terminals', (req, res) => {
    res.json({ terminals: terminalCards });
  });

  router.get('/wecom/sandbox', (req, res) => {
    res.json({
      corpId: 'ww-demo-corp',
      agentId: '1000088',
      authFlow: ['企微 OAuth code', 'BFF 换取 userId', '员工身份归一', 'JWT 签发', '会话上下文恢复'],
      risks: ['code 复用', '跨端 token 不一致', '外部联系人权限边界', 'JS-SDK config 签名过期'],
      mitigations: ['一次性 code 校验', 'identity center', 'scope 白名单', '签名缓存 + 过期刷新']
    });
  });

  router.get('/specs', async (req, res) => {
    res.json({ specs: await store.listRecords('enablement_specs', 50) });
  });

  router.post('/specs/generate/stream', async (req, res) => {
    initSse(res);
    const text = aiService.specCodingPlan(req.body);
    await aiService.streamMarkdown(res, text, sendEvent, 16);
    closeSse(res);
  });

  router.get('/skills', async (req, res) => {
    res.json({ skills: await store.listRecords('ai_skills', 50) });
  });

  router.post('/skills/:id/run/stream', async (req, res) => {
    initSse(res);
    const skill = skills.find((item) => item.id === req.params.id) || skills[0];
    sendEvent(res, 'step', { status: 'running', title: '解析 Skill 输入 Schema' });
    await sleep(260);
    sendEvent(res, 'step', { status: 'running', title: `调用工具：${skill.tools.join(' -> ')}` });
    await sleep(360);
    const result = aiService.skillRunResult(skill, req.body);
    await store.createRecord('skill_runs', {
      skillId: skill.id,
      input: req.body,
      result,
      operatorId: req.user._id,
      status: 'success'
    });
    await aiService.streamMarkdown(res, result, sendEvent, 16);
    closeSse(res);
  });

  router.post('/assistant/sessions', async (req, res) => {
    const session = await store.createRecord('assistant_sessions', {
      employeeId: req.user._id,
      channel: req.body.channel || 'wecom',
      title: req.body.title || '企微智能问答会话',
      memory: [],
      status: 'active'
    });
    res.status(201).json({ session });
  });

  router.get('/assistant/sessions', async (req, res) => {
    res.json({ sessions: await store.listRecords('assistant_sessions', 30) });
  });

  router.post('/assistant/sessions/:id/stream', async (req, res) => {
    const session = await store.getRecord('assistant_sessions', req.params.id);
    if (!session) return res.status(404).json({ message: 'session not found' });
    const question = req.body.question || '如何在企微里给客户生成展业话术？';
    initSse(res);
    sendEvent(res, 'memory', { memory: session.memory || [] });
    const rawContexts = await store.searchChunks(question, 30);
    const contexts = aiService.prioritizeContexts(question, rawContexts);
    const insight = aiService.questionInsight(question, contexts);
    sendEvent(res, 'retrieval', { contexts });
    sendEvent(res, 'answer_meta', {
      intent: insight.intent,
      confidence: insight.confidence,
      reliable: contexts.some((item) => item.score >= 0.08)
    });
    const answer = aiService.enablementAssistantAnswer(question, contexts, session.memory || []);
    const nextMemory = [...(session.memory || []), { role: 'user', content: question }, { role: 'assistant', content: answer.slice(0, 220) }].slice(-8);
    await store.updateRecord('assistant_sessions', req.params.id, { memory: nextMemory, lastQuestion: question });
    await aiService.streamMarkdown(res, answer, sendEvent, 16);
    closeSse(res);
  });

  router.get('/annotation/tasks', async (req, res) => {
    res.json({ tasks: await store.listRecords('annotation_tasks', 50) });
  });

  router.post('/annotation/tasks/:id/prelabel', async (req, res) => {
    const task = await store.getRecord('annotation_tasks', req.params.id);
    if (!task) return res.status(404).json({ message: 'task not found' });
    const updated = await store.updateRecord('annotation_tasks', req.params.id, {
      aiSuggestion: 'AI 已完成预标注：发现 3 个低置信度区域，建议人工复核后提交',
      status: 'ai_prechecked'
    });
    res.json({ task: updated });
  });

  router.get('/visualization', (req, res) => {
    res.json({
      quality: [
        { name: '供应商 A', value: 96.2 },
        { name: '供应商 B', value: 91.4 },
        { name: '内部团队', value: 98.1 }
      ],
      trajectory: [
        [22, 68],
        [31, 62],
        [42, 58],
        [55, 49],
        [68, 44],
        [79, 38]
      ],
      mapProvider: 'demo-svg; production can use OpenLayers or Leaflet'
    });
  });

  return router;
}
