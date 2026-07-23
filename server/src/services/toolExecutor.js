import crypto from 'node:crypto';

export function buildDeliveryArtifacts({ intent, prompt, sources }) {
  const citations = sources.map((source, index) => `[${index + 1}] ${source.documentTitle} · score ${Number(source.score || 0).toFixed(4)}`);
  const sourceBlock = citations.length ? citations.join('\n') : '当前没有命中引用，建议补充业务文档或项目规范。';
  const base = {
    goal: intent.goal,
    sourceCount: sources.length,
    riskLevel: intent.riskLevel
  };
  const isKnowledge = intent.id === 'knowledge-assistant';
  const isReview = intent.id === 'delivery-review-agent';
  const productGoal = isKnowledge
    ? '建设可审计的知识库问答与运营纠错工作台，回答必须带引用、可反馈、可复核。'
    : isReview
      ? '建设交付质量评审工作台，审查 PRD、页面、API、测试策略、上线风险和人工确认项。'
      : '建设从业务需求到 PRD、页面结构、BFF API、研发任务和风险确认的 AI 交付工作台。';
  const users = isKnowledge
    ? ['运营同学：维护知识范围、纠错反馈和答案质量。', '客服/业务人员：在会话中检索可信答案。', '研发同学：评审 RAG、会话、反馈和权限接口。', '质检同学：复核引用命中、幻觉风险和知识缺口。']
    : isReview
      ? ['交付负责人：确认方案是否具备上线条件。', '前端工程师：修复页面结构、交互和埋点风险。', '后端工程师：确认 BFF API、审计字段和权限边界。', '测试工程师：补齐回归、契约测试和质量门禁。']
      : ['产品经理：输入需求并确认 PRD 方向。', '前端工程师：评审页面结构、状态流和交互细节。', '后端工程师：评审 BFF API、数据模型和权限边界。', '测试工程师：评审测试策略、验收标准和回归范围。'];
  const pages = isKnowledge
    ? [
      { name: '知识库管理', modules: ['文档上传', '切分策略', 'Scope 标签', '索引状态'] },
      { name: '智能问答会话', modules: ['自然语言问题', '流式答案', '引用卡片', '追问上下文'] },
      { name: '人工纠错台', modules: ['答案反馈', '知识缺口', '纠错审批', '质量指标'] },
      { name: '检索审计', modules: ['query', 'chunk', 'score', 'retrievalBackend'] }
    ]
    : isReview
      ? [
        { name: '交付物导入', modules: ['PRD', '页面结构', 'API Contract', '测试策略'] },
        { name: '质量评审面板', modules: ['完整度检查', '接口合理性', '测试缺口', '上线风险'] },
        { name: '整改任务', modules: ['负责人', '优先级', '验收标准', '截止时间'] },
        { name: '审批审计', modules: ['确认', '驳回', '修订', 'Trace 回放'] }
      ]
      : [
        { name: '自然语言输入区', modules: ['任务输入', '意图识别', '上下文范围', '模型状态'] },
        { name: 'Agent 执行区', modules: ['流式输出', '工具调用', '引用来源', '失败重试'] },
        { name: '交付物区', modules: ['PRD', '页面结构', 'API Contract', '研发任务', '风险确认'] },
        { name: '审计区', modules: ['Trace 时间线', 'Token/耗时', '人工确认', '审批历史'] }
      ];
  const apiContract = isKnowledge
    ? {
      'POST /api/knowledge/search': {
        request: { query: 'string', scopes: intent.scopes, topK: 5 },
        response: ['answerDraft', 'citations', 'missingScopes', 'confidence']
      },
      'POST /api/conversations/:id/messages': {
        request: { message: 'string', sessionMemory: 'optional' },
        responseEvents: ['delta', 'citation', 'feedback_required', 'final']
      },
      'POST /api/knowledge/feedback': {
        request: { answerId: 'string', action: 'accept | correct | reject', note: 'string' },
        response: ['feedbackId', 'reviewStatus']
      }
    }
    : isReview
      ? {
        'POST /api/delivery-review/runs': {
          request: { artifacts: ['prd', 'flow', 'api', 'task'], gates: ['contract', 'test', 'release'] },
          response: ['riskItems', 'missingTests', 'approvalRequired', 'traceId']
        },
        'PATCH /api/delivery-review/items/:id': {
          request: { owner: 'string', priority: 'P0 | P1 | P2', acceptance: 'string' },
          response: ['status', 'auditLog']
        }
      }
      : {
        'POST /api/agent-studio/sessions/:id/runs/stream': {
          request: { message: 'string', agentId: intent.id, model: 'optional provider config' },
          responseEvents: ['run_status', 'trace', 'sources', 'artifact', 'delta', 'review', 'final']
        },
        'GET /api/agent-studio/runs/:id': {
          response: ['status', 'intent', 'trace', 'sources', 'artifacts', 'review']
        }
      };
  const taskLines = isKnowledge
    ? [
      '- Frontend：实现问答会话、引用卡片、纠错入口和知识命中面板。',
      '- BFF：实现 search、conversation、feedback 三类接口与权限审计。',
      '- RAG：接入向量检索、chunk score 展示、低置信度降级策略。',
      '- QA：建立引用准确率、人工纠错采纳率和幻觉拦截用例。'
    ]
    : isReview
      ? [
        '- Frontend：实现评审面板、风险列表、整改任务和审批状态流。',
        '- BFF：实现交付物导入、质量门禁检查、审批与审计接口。',
        '- Test：补齐契约测试、回归路径、上线 checklist 和失败回放。',
        '- Ops：把高风险项同步到 AgentOps Run Detail 和审批历史。'
      ]
      : [
        '- Frontend：实现需求输入、流式分析、Artifact 工作台和人工确认。',
        '- BFF：实现 Run 状态机、RAG 检索、Tool Calling、Artifact 版本接口。',
        '- Model：接入 LLM Provider fallback、引用来源和输出结构校验。',
        '- QA：覆盖 SSE 中断、重试、Artifact 审批和 Eval 质量评分。'
      ];

  return [
    {
      id: `agent-artifact-prd-${crypto.randomUUID()}`,
      type: 'prd',
      title: `${intent.label} PRD 摘要`,
      status: 'draft',
      content: [
        `# ${intent.label} PRD 摘要`,
        '',
        '## 用户输入',
        prompt,
        '',
        '## 产品目标',
        `- ${productGoal}`,
        '- 通过自然语言交互完成需求澄清、上下文检索、产物生成和人工确认。',
        '- 输出内容必须可引用、可追踪、可复盘。',
        '',
        '## 核心用户',
        ...users.map((item) => `- ${item}`),
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
        pages,
        states: ['idle', 'intent_detected', 'retrieving', 'planning', 'streaming', 'review_required', 'completed']
      }
    },
    {
      id: `agent-artifact-api-${crypto.randomUUID()}`,
      type: 'api',
      title: 'BFF API Contract',
      status: 'draft',
      content: {
        ...apiContract,
        guardrails: ['高风险工具必须人工确认', '所有关键结论需要 citation', '失败必须可重试并保留 Trace']
      }
    },
    {
      id: `agent-artifact-task-${crypto.randomUUID()}`,
      type: 'task',
      title: isReview ? '整改任务拆解' : isKnowledge ? '知识库问答落地任务' : '研发任务拆解',
      status: 'draft',
      content: [
        `# ${isReview ? '整改任务拆解' : isKnowledge ? '知识库问答落地任务' : '研发任务拆解'}`,
        '',
        ...taskLines,
        '',
        '## 验收策略',
        '- 意图识别：同一需求不同表达应映射到稳定 Agent 类型。',
        '- RAG：引用来源必须包含 chunk、score、sourcePath 和 retrievalBackend。',
        '- SSE：覆盖流式输出、中断、重试、Provider fallback。',
        '- Artifact：PRD、Flow、API、Task、Risk 均可预览、复制、导出和确认。',
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

export function buildFallbackAnswer({ intent, sources, artifacts }) {
  const citationText = sources.map((source, index) => `- [${index + 1}] ${source.documentTitle}：${String(source.content || '').slice(0, 120)}`).join('\n');
  const retrievalBackends = [...new Set(sources.map((source) => source.retrievalBackend || 'unknown'))];
  const hasLiveVector = retrievalBackends.includes('mongodb-atlas-vector-search');
  const artifactTypes = artifacts.map((artifact) => artifact.type).join(' / ') || 'no artifact';
  return [
    `## ${intent.label}`,
    '',
    '> 当前内容由 deterministic Agent Runtime 生成；真实 LLM Provider 可用时会替换为模型流式输出。',
    '',
    `我已识别到你的目标是：${intent.goal}`,
    '',
    '### 执行路径',
    '- 识别自然语言意图，并选择合适 Agent。',
    '- 根据 Agent scopes 检索知识库上下文，并记录 retrievalBackend。',
    `- 生成结构化 Artifact：${artifactTypes}。`,
    '- 高风险输出进入人工确认，保留 Trace 可审计链路。',
    '',
    '### 检索状态',
    `- retrievalBackend：${hasLiveVector ? 'mongodb-atlas-vector-search' : (retrievalBackends.join(' / ') || 'no-source')}`,
    `- citationCount：${sources.length}`,
    '',
    '### 本次产物',
    ...artifacts.map((artifact) => `- ${artifact.title}（${artifact.type}）`),
    '',
    '### 引用来源',
    citationText || '- 暂无引用来源，需要补充知识库文档。'
  ].join('\n');
}
