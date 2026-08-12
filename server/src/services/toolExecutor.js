import crypto from 'node:crypto';
import { generateLlmAnswer } from './llmProvider.js';

function buildSourceBlock (sources) {
    if (!sources || !Array.isArray(sources) || !sources.length) return '当前没有命中引用，建议补充业务文档或项目规范。';
    return sources
        .map((s, i) => `[${i + 1}] ${s.documentTitle} · score ${Number(s.score || 0).toFixed(4)}`)
        .join('\n');
}

function buildSourceContext (sources) {
    if (!sources || !Array.isArray(sources) || !sources.length) return '（无引用来源）';
    return sources
        .map((s, i) => `[${i + 1}] ${s.documentTitle}\n路径: ${s.sourcePath || 'unknown'}\n内容: ${String(s.content || '').slice(0, 500)}`)
        .join('\n\n');
}

async function llmGenerateArtifact ({ type, prompt, sources, intent, fallback }) {
    const safeSources = Array.isArray(sources) ? sources : [];
    const sourceContext = buildSourceContext(safeSources);
    const sourceCount = safeSources.length;

    const prompts = {
        prd: `你是产品经理。基于以下需求和引用来源，生成一份 PRD 摘要。

需求：${prompt}
可用引用来源（共 ${sourceCount} 条）：
${sourceContext}

输出要求：
1. 用 Markdown 格式
2. 包含：产品定位、目标用户、核心功能、功能模块、验收标准
3. 引用规则：只有当某句结论确实来自上面某条来源的原文时，才在该句末尾标注对应编号 [n]；不同结论各自引用真正支持它的来源，禁止把多条结论都挂在同一个编号上
4. 属于通用产品实践、非来源原文支持的内容，不带引用标记
5. 只能引用上面列出的来源，禁止编造引用编号
6. 如果来源没覆盖某个问题，明确写"未在知识库中找到相关资料"，且该句不带引用`,

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
引用规则：仅当某条任务的依据确实来自上面某条来源原文时，才在该条末尾标注对应编号 [n]；通用工程实践不带引用，禁止编造编号或把所有任务挂同一编号。`,

        risk: `你是风险评估专家。基于以下需求和引用来源，识别风险和待确认问题。

需求：${prompt}
可用引用来源（共 ${sourceCount} 条）：
${sourceContext}

输出结构（Markdown）：
## 主要风险
## 待确认问题
## 引用依据

引用规则（必须严格遵守）：
1. 只有当某条风险的内容确实来自上面某条来源的原文时，才在该条末尾标注对应编号 [n]，n 与来源编号一致
2. 不同风险各自引用真正支持它的那条来源，禁止把所有条目都挂在同一个编号上
3. 属于通用最佳实践、非来源原文支持的建议，一律不带引用标记
4. "引用依据"一节只列出正文中实际被引用过的来源编号和标题；若正文没有任何引用，则写"本节无知识库引用"
5. 禁止编造不存在的编号`
    };

    try {
        const result = await generateLlmAnswer({
            systemPrompt: '你是企业级 AI 产品交付专家。严格按引用来源生成内容，禁止编造引用编号。',
            prompt: prompts[type] || prompts.prd,
            modelConfig: {},
            fallback
        });

        let text = '';
        if (typeof result === 'string') {
            text = result;
        } else if (result && typeof result === 'object') {
            text = result.text || result.content || result.output || '';
        }

        console.log(`[toolExecutor] ${type} LLM 返回 text 长度: ${text.length}`);

        if (!text || text.length < 30) {
            console.warn(`[toolExecutor] ${type} LLM 返回空或太短，使用 fallback`);
            return fallback;
        }
        return text;
    } catch (error) {
        console.error(`[toolExecutor] LLM 生成 ${type} 异常:`, error.message);
        return fallback;
    }
}

function markdownTitle (content, fallback) {
    const matched = String(content || '').match(/^#\s+(.+)$/m);
    return matched?.[1]?.trim() || fallback;
}

function artifactTitles (taskModeId, intentLabel) {
    if (taskModeId === 'delivery-review') {
        return ['交付质量评审报告', '测试策略与验收路径', '接口与数据契约审计', '上线门禁与整改任务', '风险与人工审批建议'];
    }
    if (taskModeId === 'knowledge-assistant') {
        return ['知识库问答方案', '会话与纠错状态流', '检索与反馈 API Contract', '知识运营任务', '幻觉与治理风险'];
    }
    if (taskModeId === 'requirement-analysis') {
        return ['架构级需求分析', '业务流程与验收状态', '系统边界与接口约束', '交付任务拆解', '风险与待确认问题'];
    }
    return [`${intentLabel} PRD 摘要`, '页面与状态流', 'BFF API Contract', '研发任务拆解', '风险与人工确认问题'];
}

export async function buildDeliveryArtifacts ({ intent, prompt, sources = [], taskModeId }) {
    const safeSources = Array.isArray(sources) ? sources : [];
    const citations = safeSources.map((source, index) => `[${index + 1}] ${source.documentTitle} · score ${Number(source.score || 0).toFixed(4)}`);
    const sourceBlock = citations.length ? citations.join('\n') : '当前没有命中引用，建议补充业务文档或项目规范。';
    const base = {
        goal: intent.goal,
        sourceCount: safeSources.length,
        riskLevel: intent.riskLevel
    };

    const titles = artifactTitles(taskModeId, intent.label);

    const fallbackPrd = [
        `# ${titles[0]}`,
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
        pages: [
            { name: '主页面', modules: ['核心功能', '辅助功能'] },
            { name: '详情页', modules: ['详情展示', '操作区'] },
            { name: '管理页', modules: ['列表', '筛选', '操作'] }
        ],
        states: ['idle', 'loading', 'editing', 'saving', 'saved', 'error']
    };

    const fallbackApi = {
        'GET /api/items': {
            request: { page: 'number', size: 'number' },
            response: ['items[]', 'total', 'page', 'size']
        },
        'POST /api/items': {
            request: { name: 'string', type: 'string' },
            response: ['itemId', 'createdAt']
        },
        guardrails: ['高风险操作必须人工确认', '所有关键结论需要引用', '失败必须可重试']
    };

    const fallbackTask = [
        '# 研发任务拆解',
        '',
        '- Frontend：实现核心页面、交互和人工确认。',
        '- BFF：实现 API、RAG 检索、Tool Calling。',
        '- Model：接入 LLM Provider、引用来源和输出校验。',
        '- QA：覆盖中断、重试、审批和 Eval 评分。'
    ].join('\n');

    const fallbackRisk = [
        '# 风险与人工确认问题',
        '',
        '## 主要风险',
        '- LLM 失败时进入 fallback，保留审计记录。',
        '- RAG 命中不足时标记低置信度。',
        '- 高风险动作必须人工确认。',
        '',
        '## 待确认问题',
        '- 目标用户与权限边界是否清晰？',
        '- 是否允许 Agent 自动触发外部写入？',
        '',
        '## 引用依据',
        sourceBlock
    ].join('\n');

    console.log(`[toolExecutor] 开始并行 LLM 生成, sources=${safeSources.length}`);

    let prdContent, flowContent, apiContent, taskContent, riskContent;
    try {
        [prdContent, flowContent, apiContent, taskContent, riskContent] = await Promise.all([
            llmGenerateArtifact({ type: 'prd', prompt, sources: safeSources, intent, fallback: fallbackPrd }),
            llmGenerateArtifact({ type: 'flow', prompt, sources: safeSources, intent, fallback: JSON.stringify(fallbackFlow) }),
            llmGenerateArtifact({ type: 'api', prompt, sources: safeSources, intent, fallback: JSON.stringify(fallbackApi) }),
            llmGenerateArtifact({ type: 'task', prompt, sources: safeSources, intent, fallback: fallbackTask }),
            llmGenerateArtifact({ type: 'risk', prompt, sources: safeSources, intent, fallback: fallbackRisk })
        ]);
        console.log(`[toolExecutor] 5 个 Artifact 生成完成`);
    } catch (error) {
        console.error(`[toolExecutor] Promise.all 失败:`, error.message);
        prdContent = fallbackPrd;
        flowContent = JSON.stringify(fallbackFlow);
        apiContent = JSON.stringify(fallbackApi);
        taskContent = fallbackTask;
        riskContent = fallbackRisk;
    }

    let flowJson = fallbackFlow;
    try {
        flowJson = typeof flowContent === 'string'
            ? JSON.parse(flowContent.replace(/^```json\s*/, '').replace(/```$/, '').trim())
            : flowContent;
    } catch (e) {
        console.warn('[toolExecutor] flow JSON 解析失败，用 fallback');
    }

    let apiJson = fallbackApi;
    try {
        apiJson = typeof apiContent === 'string'
            ? JSON.parse(apiContent.replace(/^```json\s*/, '').replace(/```$/, '').trim())
            : apiContent;
    } catch (e) {
        console.warn('[toolExecutor] api JSON 解析失败，用 fallback');
    }

    return [
        {
            id: `agent-artifact-prd-${crypto.randomUUID()}`,
            type: 'prd',
            title: markdownTitle(prdContent, titles[0]),
            status: 'draft',
            content: prdContent || fallbackPrd
        },
        {
            id: `agent-artifact-flow-${crypto.randomUUID()}`,
            type: 'flow',
            title: titles[1],
            status: 'draft',
            content: flowJson
        },
        {
            id: `agent-artifact-api-${crypto.randomUUID()}`,
            type: 'api',
            title: titles[2],
            status: 'draft',
            content: apiJson
        },
        {
            id: `agent-artifact-task-${crypto.randomUUID()}`,
            type: 'task',
            title: titles[3],
            status: 'draft',
            content: taskContent || fallbackTask
        },
        {
            id: `agent-artifact-risk-${crypto.randomUUID()}`,
            type: 'risk',
            title: titles[4],
            status: 'draft',
            content: riskContent || fallbackRisk
        }
    ];
}

export function buildFallbackAnswer ({ intent, sources = [], artifacts = [] }) {
    const safeSources = Array.isArray(sources) ? sources : [];
    const safeArtifacts = Array.isArray(artifacts) ? artifacts : [];

    const citationText = safeSources
        .map((source, index) => `- [${index + 1}] ${source.documentTitle}：${String(source.content || '').slice(0, 120)}`)
        .join('\n');
    const retrievalBackends = [...new Set(safeSources.map((source) => source.retrievalBackend || 'unknown'))];
    const hasLiveVector = retrievalBackends.some((backend) => (
        backend === 'mongodb-atlas-vector-search' || backend === 'mongodb-atlas-hybrid-search'
    ));
    const artifactTypes = safeArtifacts.map((artifact) => artifact.type).join(' / ') || 'no artifact';

    return [
        `## ${intent.label}`,
        '',
        '> 当前内容由 deterministic Agent Runtime 生成。',
        '',
        `我已识别到你的目标是：${intent.goal}`,
        '',
        '### 执行路径',
        '- 识别自然语言意图。',
        '- 检索知识库上下文。',
        `- 生成结构化 Artifact：${artifactTypes}。`,
        '- 高风险输出进入人工确认。',
        '',
        '### 检索状态',
        `- retrievalBackend：${hasLiveVector ? 'mongodb-atlas-vector-search' : (retrievalBackends.join(' / ') || 'no-source')}`,
        `- citationCount：${safeSources.length}`,
        '',
        '### 本次产物',
        ...safeArtifacts.map((artifact) => `- ${artifact.title}（${artifact.type}）`),
        '',
        '### 引用来源',
        citationText || '- 暂无引用来源。'
    ].join('\n');
}
