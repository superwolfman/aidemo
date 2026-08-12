export const skillDefinitions = [
    {
        id: 'product-workflow',
        name: 'AI 产品工作流 Skill',
        version: '1.0.0',
        description: '把业务需求转成需求摘要、用户流程、页面原型、接口协议、研发任务和待确认问题。',
        systemPrompt: '你是 AI 产品前端交付专家，必须从业务需求出发，输出可落地的 PRD 摘要、页面模块、用户流程、接口协议、状态流转、研发任务拆解、风险和待确认问题。',
        inputSchema: {
            type: 'object',
            required: ['businessRequirement', 'targetUsers', 'deliveryGoal'],
            properties: {
                businessRequirement: { type: 'string', minLength: 20 },
                targetUsers: { type: 'string' },
                deliveryGoal: { type: 'string' },
                constraints: { type: 'string' }
            }
        },
        outputSchema: {
            type: 'object',
            required: ['requirementSummary', 'userFlow', 'pagePrototype', 'apiContract', 'taskBreakdown', 'openQuestions'],
            properties: {
                requirementSummary: { type: 'array', items: { type: 'string' } },
                userFlow: { type: 'array', items: { type: 'string' } },
                pagePrototype: { type: 'array', items: { type: 'string' } },
                apiContract: { type: 'array', items: { type: 'string' } },
                taskBreakdown: { type: 'array', items: { type: 'string' } },
                openQuestions: { type: 'array', items: { type: 'string' } }
            }
        },
        allowedTools: ['searchKnowledge', 'generateProductWorkflowArtifacts'],
        knowledgeScopes: ['architecture', 'standards', 'ai-native', 'frontend']
    },
    {
        id: 'engineering-productivity',
        name: '研发提效 Skill',
        version: '1.1.0',
        description: '面向前端团队研发流程，生成代码脚手架、测试策略、文档草稿和 PR 检查建议。',
        systemPrompt: '你是 AI 研发效能专家，必须围绕代码生成、测试辅助、文档生成、PR 审查和团队落地规范输出可执行方案。',
        inputSchema: {
            type: 'object', required: ['workflowGoal', 'targetStack'],
            properties: { workflowGoal: { type: 'string' }, targetStack: { type: 'string' }, qualityGate: { type: 'string' } }
        },
        outputSchema: {
            type: 'object', required: ['automationPlan', 'testPlan', 'codeArtifacts', 'adoptionMetrics'],
            properties: {
                automationPlan: { type: 'array', items: { type: 'string' } },
                testPlan: { type: 'array', items: { type: 'string' } },
                codeArtifacts: { type: 'array', items: { type: 'string' } },
                adoptionMetrics: { type: 'array', items: { type: 'string' } }
            }
        },
        allowedTools: ['searchKnowledge', 'analyzeRepository', 'generateEngineeringArtifacts'],
        knowledgeScopes: ['standards', 'sdk', 'architecture']
    },
    {
        id: 'requirement-analysis',
        name: '需求分析 Skill',
        version: '1.0.0',
        description: '把业务输入拆成目标、约束、风险、验收标准和待确认问题。',
        systemPrompt: '你是资深架构需求分析师，必须输出结构化需求分析，标出不确定项和验收标准。',
        inputSchema: {
            type: 'object', required: ['businessGoal', 'constraints'],
            properties: { businessGoal: { type: 'string', minLength: 10 }, constraints: { type: 'array', items: { type: 'string' } } }
        },
        outputSchema: {
            type: 'object', required: ['summary', 'acceptanceCriteria', 'risks', 'openQuestions'],
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
            type: 'object', required: ['proposal', 'targetSystem'],
            properties: { proposal: { type: 'string' }, targetSystem: { type: 'string' } }
        },
        outputSchema: {
            type: 'object', required: ['decision', 'tradeoffs', 'guardrails', 'nextActions'],
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
            type: 'object', required: ['diffSummary', 'riskLevel'],
            properties: { diffSummary: { type: 'string' }, riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] } }
        },
        outputSchema: {
            type: 'object', required: ['findings', 'testGaps', 'recommendation'],
            properties: {
                findings: { type: 'array', items: { type: 'string' } },
                testGaps: { type: 'array', items: { type: 'string' } },
                recommendation: { type: 'string' }
            }
        },
        allowedTools: ['analyzeRepository', 'searchKnowledge'],
        knowledgeScopes: ['standards', 'sdk']
    },
    {
        id: 'context-engineering',
        name: '上下文工程 Skill',
        version: '1.0.0',
        description: '为 Agent 任务设计 Prompt、上下文分层、RAG 拼接、压缩、隔离和引用策略。',
        systemPrompt: '你是 Context Engineering 专家，必须说明上下文来源、优先级、压缩策略、引用策略、工具状态和幻觉防护。',
        inputSchema: {
            type: 'object', required: ['agentGoal', 'contextSources'],
            properties: { agentGoal: { type: 'string' }, contextSources: { type: 'array', items: { type: 'string' } }, riskControl: { type: 'string' } }
        },
        outputSchema: {
            type: 'object', required: ['promptContract', 'contextLayers', 'compressionPolicy', 'guardrails'],
            properties: {
                promptContract: { type: 'string' },
                contextLayers: { type: 'array', items: { type: 'string' } },
                compressionPolicy: { type: 'array', items: { type: 'string' } },
                guardrails: { type: 'array', items: { type: 'string' } }
            }
        },
        allowedTools: ['searchKnowledge', 'composeContextPack'],
        knowledgeScopes: ['architecture', 'standards', 'sdk']
    }
];

export const agentCapabilities = [
    {
        id: 'product-delivery-agent', name: '产研测交付 Agent',
        description: '把自然语言需求转成 PRD、页面方案、接口契约、测试策略和发布清单。',
        intents: ['需求澄清', '页面方案', '接口协同', '研发任务拆解', '测试与发布'],
        tools: ['detectIntent', 'retrieveKnowledge', 'planDelivery', 'generateArtifacts', 'requestHumanReview']
    },
    {
        id: 'knowledge-assistant', name: '知识库问答 Agent',
        description: '围绕项目规范、AI Native 交互、RAG 与前端工程约束回答问题并给出引用。',
        intents: ['知识问答', '规范查询', '方案解释', '风险提示'],
        tools: ['detectIntent', 'retrieveKnowledge', 'answerWithCitations']
    },
    {
        id: 'delivery-review-agent', name: '交付评审 Agent',
        description: '审查产物完整度、接口合理性、测试缺口、风险和人工确认项。',
        intents: ['方案评审', '测试缺口', '上线风险', '质量门禁'],
        tools: ['detectIntent', 'retrieveKnowledge', 'reviewArtifacts', 'requestHumanReview']
    }
];

// Task Mode 是面向业务的编排入口，Agent 是实际执行器。两者可以是多对一关系，
// 例如“产品交付工作流”和“架构级需求分析”都复用产研测交付 Agent。
export const agentTaskModes = [
    { id: 'product-workflow', label: '产品交付工作流', agentId: 'product-delivery-agent', goal: '把需求转成 PRD、页面结构、API Contract、研发任务和测试策略。', riskLevel: 'high' },
    { id: 'requirement-analysis', label: '架构级需求分析', agentId: 'product-delivery-agent', goal: '把业务目标拆解为约束、风险、验收标准和待确认问题。', riskLevel: 'high' },
    { id: 'knowledge-assistant', label: '知识库问答与运营纠错', agentId: 'knowledge-assistant', goal: '检索可信上下文并输出带引用答案、知识缺口和纠错建议。', riskLevel: 'medium' },
    { id: 'delivery-review', label: '交付质量评审', agentId: 'delivery-review-agent', goal: '评估交付物完整度、测试缺口、上线风险、质量门禁和人工审批项。', riskLevel: 'high' }
];

export function getAgentTaskMode (id) {
    return agentTaskModes.find((mode) => mode.id === id) || null;
}

// 显式选择的 Task Mode 是本次运行的编排意图；关键词识别结果仅作为审计证据保留。
export function resolveTaskModeIntent (detectedIntent, commandOptions = {}) {
    const taskMode = getAgentTaskMode(commandOptions.taskModeId);
    if (!taskMode) return detectedIntent;
    return {
        ...detectedIntent,
        id: taskMode.agentId,
        label: taskMode.label,
        goal: taskMode.goal,
        riskLevel: taskMode.riskLevel,
        signals: [...new Set([...(detectedIntent?.signals || []), `task_mode:${taskMode.id}`])]
    };
}

export function buildRunExecutionContext (commandOptions = {}, selectedAgent = null) {
    const taskMode = getAgentTaskMode(commandOptions.taskModeId);
    return {
        source: String(commandOptions.source || 'agent-studio'),
        taskMode: taskMode ? { id: taskMode.id, label: taskMode.label } : null,
        requestedAgentId: commandOptions.agentId || null,
        requestedSkillId: commandOptions.skillId || null,
        resolvedAgentId: selectedAgent?.id || null
    };
}

export function getAgentCapability (intent) {
    return agentCapabilities.find((cap) => cap.id === intent?.id) || agentCapabilities[0];
}

export function getSkillById (id) {
    return skillDefinitions.find((skill) => skill.id === id) || null;
}

export function listSkillDefinitions () {
    return skillDefinitions;
}

/** 校验单个 SkillDefinition 的契约完整性 */
export function validateSkill (skill) {
    const errors = [];
    if (!skill || typeof skill !== 'object') return { valid: false, errors: ['skill is null'] };
    if (!skill.id) errors.push('missing id');
    if (!Array.isArray(skill.inputSchema?.required) || !skill.inputSchema.required.length) errors.push('missing inputSchema.required');
    if (!Array.isArray(skill.outputSchema?.required) || !skill.outputSchema.required.length) errors.push('missing outputSchema.required');
    if (!Array.isArray(skill.allowedTools)) errors.push('allowedTools must be array');
    if (!Array.isArray(skill.knowledgeScopes)) errors.push('knowledgeScopes must be array');
    return { valid: errors.length === 0, errors };
}

/** 按 skillId 取白名单工具，越权调用前做护栏 */
export function getAllowedTools (skillId) {
    const skill = getSkillById(skillId);
    return skill ? skill.allowedTools : [];
}

/** 按 skillId 取知识域，RAG 召回时按此过滤 */
export function getKnowledgeScopes (skillId) {
    const skill = getSkillById(skillId);
    return skill ? skill.knowledgeScopes : [];
}
