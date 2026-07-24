import crypto from 'node:crypto';
import { generateLlmAnswer } from './llmProvider.js';

function buildSourceBlock (sources) {
    if (!sources.length) return '当前没有命中引用，建议补充业务文档或项目规范。';
    return sources
        .map((s, i) => `[${i + 1}] ${s.documentTitle} · score ${Number(s.score || 0).toFixed(4)}`)
        .join('\n');
}

function buildSourceContext (sources) {
    if (!sources.length) return '（无引用来源）';
    return sources
        .map((s, i) => `[${i + 1}] ${s.documentTitle}\n路径: ${s.sourcePath || 'unknown'}\n内容: ${String(s.content || '').slice(0, 500)}`)
        .join('\n\n');
}

async function llmGenerateArtifact ({ type, prompt, sources, intent, fallback }) {
    const sourceContext = buildSourceContext(sources);
    const sourceCount = sources.length;

    const prompts = {
        prd: `你是产品经理。基于以下需求和引用来源，生成一份 PRD 摘要。

需求：${prompt}
可用引用来源（共 ${sourceCount} 条）：
${sourceContext}

输出要求：
1. 用 Markdown 格式
2. 包含：产品定位、目标用户、核心功能、功能模块、验收标准
3. 引用来源时用 [1] [2] 这种编号，与上面编号一致
4. 只能引用上面列出的来源，禁止编造引用编号
5. 如果来源没覆盖某个问题，明确写"未在知识库中找到相关资料"`,

        flow: `你是前端架构师。基于以下需求和引用来源，设计页面结构和状态流转。

需求：${prompt}
可用引用来源（共 ${sourceCount} 条）：
${sourceContext}

输出要求（纯 JSON，不要 markdown 代码块）：
{
  "goal": "一句话描述产品目标",
  "pages": [{ "name": "页面名", "modules": ["模块1", "模块2"] }],
  "states": ["idle", "intent_detected", "retrieving", "streaming", "review_required", "completed"],
  "interactionRules": ["交互规则1"]
}
只输出 JSON，不要其他文字。`,

        api: `你是后端架构师。基于以下需求和引用来源，设计 BFF API Contract。

需求：${prompt}
可用引用来源（共 ${sourceCount} 条）：
${sourceContext}

输出要求（纯 JSON，不要 markdown 代码块）：
{
  "POST /api/xxx": { "request": { "field": "type" }, "response": ["field1"] },
  "GET /api/xxx/:id": { "response": ["field1"] },
  "guardrails": ["约束1", "约束2"]
}
只输出 JSON，不要其他文字。`,

        task: `你是技术负责人。基于以下需求和引用来源，拆解研发任务。

需求：${prompt}
可用引用来源（共 ${sourceCount} 条）：
${sourceContext}

输出要求（Markdown）：
## Frontend
- 任务（优先级P0/P1/P2，验收标准）
## BFF
- 任务
## QA
- 任务
引用来源时用 [1] [2] 编号。`,

        risk: `你是风险评估专家。基于以下需求和引用来源，识别风险和待确认问题。

需求：${prompt}
可用引用来源（共 ${sourceCount} 条）：
${sourceContext}

输出要求（Markdown）：
## 主要风险
- 风险1（引用 [1]）
## 待确认问题
- 问题1
## 引用依据
[1] 来源名
只引用实际存在的来源，禁止编造。`
    };

    try {
        const result = await generateLlmAnswer({
            systemPrompt: '你是企业级 AI 产品交付专家。严格按引用来源生成内容，禁止编造引用编号。',
            prompt: prompts[type] || prompts.prd,
            modelConfig: {},
            fallback
        });
        return result.text || fallback;
    } catch (error) {
        console.warn(`[toolExecutor] LLM 生成 ${type} 失败，降级到模板:`, error.message);
        return fallback;
    }
}

export async function buildDeliveryArtifacts ({ intent, prompt, sources }) {
    const citations = sources.map((source, index) => `[${index + 1}] ${source.documentTitle} · score ${Number(source.score || 0).toFixed(4)}`);
    const sourceBlock = citations.length ? citations.join('\n') : '当前没有命中引用，建议补充业务文档或项目规范。';
    const base = {
        goal: intent.goal,
        sourceCount: sources.length,
        riskLevel: intent.riskLevel
    };

    // ============ 模板 fallback（LLM 失败时用）============
    const isKnowledge = intent.id === 'knowledge-assistant';
    const isReview = intent.id === 'delivery-review-agent';

    const fallbackPrd = [
        `# ${intent.label} PRD 摘要`,
        '',
        '## 用户输入',
        prompt,
        '',
        '## 产品目标',
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
    ].join('\n');

    const fallbackFlow = {
        ...base,
        pages: isKnowledge
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
                ],
        states: ['idle', 'intent_detected', 'retrieving', 'planning', 'streaming', 'review_required', 'completed']
    };

    const fallbackApi = isKnowledge
        ? {
            'POST /api/knowledge/search': {
                request: { query: 'string', scopes: intent.scopes, topK: 5 },
                response: ['answerDraft', 'citations', 'missingScopes', 'confidence']
            },
            'POST /api/knowledge/feedback': {
                request: { answerId: 'string', action: 'accept | correct | reject', note: 'string' },
                response: ['feedbackId', 'reviewStatus']
            },
            guardrails: ['高风险工具必须人工确认', '所有关键结论需要 citation', '失败必须可重试并保留 Trace']
        }
        : isReview
            ? {
                'POST /api/delivery-review/runs': {
                    request: { artifacts: ['prd', 'flow', 'api', 'task'], gates: ['contract', 'test', 'release'] },
                    response: ['riskItems', 'missingTests', 'approvalRequired', 'traceId']
                },
                guardrails: ['高风险工具必须人工确认', '所有关键结论需要 citation', '失败必须可重试并保留 Trace']
            }
            : {
                'POST /api/agent-studio/sessions/:id/runs/stream': {
                    request: { message: 'string', agentId: intent.id, model: 'optional provider config' },
                    responseEvents: ['run_status', 'trace', 'sources', 'artifact', 'delta', 'review', 'final']
                },
                'GET /api/agent-studio/runs/:id': {
                    response: ['status', 'intent', 'trace', 'sources', 'artifacts', 'review']
                },
                guardrails: ['高风险工具必须人工确认', '所有关键结论需要 citation', '失败必须可重试并保留 Trace']
            };

    const fallbackTask = [
        `# ${isReview ? '整改任务拆解' : '研发任务拆解'}`,
        '',
        '- Frontend：实现需求输入、流式分析、Artifact 工作台和人工确认。',
        '- BFF：实现 Run 状态机、RAG 检索、Tool Calling、Artifact 版本接口。',
        '- Model：接入 LLM Provider fallback、引用来源和输出结构校验。',
        '- QA：覆盖 SSE 中断、重试、Artifact 审批和 Eval 质量评分。',
        '',
        '## 验收策略',
        '- 意图识别：同一需求不同表达应映射到稳定 Agent 类型。',
        '- RAG：引用来源必须包含 chunk、score、sourcePath 和 retrievalBackend。',
        '- SSE：覆盖流式输出、中断、重试、Provider fallback。',
        '- Artifact：PRD、Flow、API、Task、Risk 均可预览、复制、导出和确认。',
        '- Human-in-the-loop：高风险节点必须暂停并记录审批结果。'
    ].join('\n');

    const fallbackRisk = [
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
    ].join('\n');

    // ============ 并行调用 LLM 生成 5 个 Artifact ============
    const [prdContent, flowContent, apiContent, taskContent, riskContent] = await Promise.all([
        llmGenerateArtifact({ type: 'prd', prompt, sources, intent, fallback: fallbackPrd }),
        llmGenerateArtifact({ type: 'flow', prompt, sources, intent, fallback: JSON.stringify(fallbackFlow) }),
        llmGenerateArtifact({ type: 'api', prompt, sources, intent, fallback: JSON.stringify(fallbackApi) }),
        llmGenerateArtifact({ type: 'task', prompt, sources, intent, fallback: fallbackTask }),
        llmGenerateArtifact({ type: 'risk', prompt, sources, intent, fallback: fallbackRisk })
    ]);

    // 解析 JSON 类型的 Artifact（flow 和 api）
    let flowJson = fallbackFlow;
    try {
        flowJson = typeof flowContent === 'string' ? JSON.parse(flowContent.replace(/^```json\s*/, '').replace(/```$/, '').trim()) : flowContent;
    } catch { /* 用 fallback */ }

    let apiJson = fallbackApi;
    try {
        apiJson = typeof apiContent === 'string' ? JSON.parse(apiContent.replace(/^```json\s*/, '').replace(/```$/, '').trim()) : apiContent;
    } catch { /* 用 fallback */ }

    return [
        {
            id: `agent-artifact-prd-${crypto.randomUUID()}`,
            type: 'prd',
            title: `${intent.label} PRD 摘要`,
            status: 'draft',
            content: prdContent
        },
        {
            id: `agent-artifact-flow-${crypto.randomUUID()}`,
            type: 'flow',
            title: '页面与状态流',
            status: 'draft',
            content: flowJson
        },
        {
            id: `agent-artifact-api-${crypto.randomUUID()}`,
            type: 'api',
            title: 'BFF API Contract',
            status: 'draft',
            content: apiJson
        },
        {
            id: `agent-artifact-task-${crypto.randomUUID()}`,
            type: 'task',
            title: '研发任务拆解',
            status: 'draft',
            content: taskContent
        },
        {
            id: `agent-artifact-risk-${crypto.randomUUID()}`,
            type: 'risk',
            title: '风险与人工确认问题',
            status: 'draft',
            content: riskContent
        }
    ];
}

export function buildFallbackAnswer ({ intent, sources, artifacts }) {
    const citationText = sources
        .map((source, index) => `- [${index + 1}] ${source.documentTitle}：${String(source.content || '').slice(0, 120)}`)
        .join('\n');
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