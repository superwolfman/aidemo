import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { config } from '../config.js';

import { getRagStatus, retrieveKnowledge } from '../services/ragEngine.js';
import { closeSse, initSse, sendEvent, sleep } from '../utils/sse.js';
// ↓ 新增：从 service 引入，移除 route 内联定义
import {
    agentCapabilities, getAgentCapability,
    skillDefinitions, getSkillById, validateSkill,
    getAllowedTools, getKnowledgeScopes
} from '../services/skillRegistry.js';
import { generateLlmAnswer, getModelPresets, getProviderStatus, streamLlmAnswer } from '../services/llmProvider.js';

const CWD = process.cwd();
const PROJECT_ROOT = path.basename(CWD) === 'server' ? path.resolve(CWD, '..') : CWD;

// const skills = [
//     {
//         id: 'product-workflow',
//         name: 'AI 产品工作流 Skill',
//         version: '1.0.0',
//         description: '把业务需求转成需求摘要、用户流程、页面原型、接口协议、研发任务和待确认问题。',
//         systemPrompt: '你是 AI 产品前端交付专家，必须从业务需求出发，输出可落地的 PRD 摘要、页面模块、用户流程、接口协议、状态流转、研发任务拆解、风险和待确认问题。',
//         inputSchema: {
//             type: 'object',
//             required: ['businessRequirement', 'targetUsers', 'deliveryGoal'],
//             properties: {
//                 businessRequirement: { type: 'string', minLength: 20 },
//                 targetUsers: { type: 'string' },
//                 deliveryGoal: { type: 'string' },
//                 constraints: { type: 'string' }
//             }
//         },
//         outputSchema: {
//             type: 'object',
//             required: ['requirementSummary', 'userFlow', 'pagePrototype', 'apiContract', 'taskBreakdown', 'openQuestions'],
//             properties: {
//                 requirementSummary: { type: 'array', items: { type: 'string' } },
//                 userFlow: { type: 'array', items: { type: 'string' } },
//                 pagePrototype: { type: 'array', items: { type: 'string' } },
//                 apiContract: { type: 'array', items: { type: 'string' } },
//                 taskBreakdown: { type: 'array', items: { type: 'string' } },
//                 openQuestions: { type: 'array', items: { type: 'string' } }
//             }
//         },
//         allowedTools: ['searchKnowledge', 'generateProductWorkflowArtifacts'],
//         knowledgeScopes: ['architecture', 'standards', 'ai-native', 'frontend']
//     },
//     {
//         id: 'engineering-productivity',
//         name: '研发提效 Skill',
//         version: '1.1.0',
//         description: '面向前端团队研发流程，生成代码脚手架、测试策略、文档草稿和 PR 检查建议。',
//         systemPrompt: '你是 AI 研发效能专家，必须围绕代码生成、测试辅助、文档生成、PR 审查和团队落地规范输出可执行方案。',
//         inputSchema: {
//             type: 'object',
//             required: ['workflowGoal', 'targetStack'],
//             properties: {
//                 workflowGoal: { type: 'string' },
//                 targetStack: { type: 'string' },
//                 qualityGate: { type: 'string' }
//             }
//         },
//         outputSchema: {
//             type: 'object',
//             required: ['automationPlan', 'testPlan', 'codeArtifacts', 'adoptionMetrics'],
//             properties: {
//                 automationPlan: { type: 'array', items: { type: 'string' } },
//                 testPlan: { type: 'array', items: { type: 'string' } },
//                 codeArtifacts: { type: 'array', items: { type: 'string' } },
//                 adoptionMetrics: { type: 'array', items: { type: 'string' } }
//             }
//         },
//         allowedTools: ['searchKnowledge', 'analyzeRepository', 'generateEngineeringArtifacts'],
//         knowledgeScopes: ['standards', 'sdk', 'architecture']
//     },
//     {
//         id: 'requirement-analysis',
//         name: '需求分析 Skill',
//         version: '1.0.0',
//         description: '把业务输入拆成目标、约束、风险、验收标准和待确认问题。',
//         systemPrompt: '你是资深架构需求分析师，必须输出结构化需求分析，标出不确定项和验收标准。',
//         inputSchema: {
//             type: 'object',
//             required: ['businessGoal', 'constraints'],
//             properties: {
//                 businessGoal: { type: 'string', minLength: 10 },
//                 constraints: { type: 'array', items: { type: 'string' } }
//             }
//         },
//         outputSchema: {
//             type: 'object',
//             required: ['summary', 'acceptanceCriteria', 'risks', 'openQuestions'],
//             properties: {
//                 summary: { type: 'string' },
//                 acceptanceCriteria: { type: 'array', items: { type: 'string' } },
//                 risks: { type: 'array', items: { type: 'string' } },
//                 openQuestions: { type: 'array', items: { type: 'string' } }
//             }
//         },
//         allowedTools: ['searchKnowledge'],
//         knowledgeScopes: ['standards', 'sdk', 'architecture']
//     },
//     {
//         id: 'architecture-review',
//         name: '架构评审 Skill',
//         version: '1.0.0',
//         description: '审查前端架构、BFF、RAG、Agent、可观测性和发布风险。',
//         systemPrompt: '你是企业级前端架构评审专家，必须基于引用资料和工程约束给出可执行评审意见。',
//         inputSchema: {
//             type: 'object',
//             required: ['proposal', 'targetSystem'],
//             properties: {
//                 proposal: { type: 'string' },
//                 targetSystem: { type: 'string' }
//             }
//         },
//         outputSchema: {
//             type: 'object',
//             required: ['decision', 'tradeoffs', 'guardrails', 'nextActions'],
//             properties: {
//                 decision: { type: 'string', enum: ['approve', 'revise', 'reject'] },
//                 tradeoffs: { type: 'array', items: { type: 'string' } },
//                 guardrails: { type: 'array', items: { type: 'string' } },
//                 nextActions: { type: 'array', items: { type: 'string' } }
//             }
//         },
//         allowedTools: ['searchKnowledge', 'analyzeRepository', 'generateArchitectureDocument'],
//         knowledgeScopes: ['architecture', 'micro-frontend', 'im', 'lowcode']
//     },
//     {
//         id: 'code-review',
//         name: '代码审查 Skill',
//         version: '1.0.0',
//         description: '面向 PR 的代码审查，关注风险、测试、性能、可维护性和工程规范。',
//         systemPrompt: '你是严谨的 Code Review Agent，先给风险，再给建议，必须指出测试缺口。',
//         inputSchema: {
//             type: 'object',
//             required: ['diffSummary', 'riskLevel'],
//             properties: {
//                 diffSummary: { type: 'string' },
//                 riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] }
//             }
//         },
//         outputSchema: {
//             type: 'object',
//             required: ['findings', 'testGaps', 'recommendation'],
//             properties: {
//                 findings: { type: 'array', items: { type: 'string' } },
//                 testGaps: { type: 'array', items: { type: 'string' } },
//                 recommendation: { type: 'string' }
//             }
//         },
//         allowedTools: ['analyzeRepository', 'searchKnowledge'],
//         knowledgeScopes: ['standards', 'sdk']
//     },
//     {
//         id: 'context-engineering',
//         name: '上下文工程 Skill',
//         version: '1.0.0',
//         description: '为 Agent 任务设计 Prompt、上下文分层、RAG 拼接、压缩、隔离和引用策略。',
//         systemPrompt: '你是 Context Engineering 专家，必须说明上下文来源、优先级、压缩策略、引用策略、工具状态和幻觉防护。',
//         inputSchema: {
//             type: 'object',
//             required: ['agentGoal', 'contextSources'],
//             properties: {
//                 agentGoal: { type: 'string' },
//                 contextSources: { type: 'array', items: { type: 'string' } },
//                 riskControl: { type: 'string' }
//             }
//         },
//         outputSchema: {
//             type: 'object',
//             required: ['promptContract', 'contextLayers', 'compressionPolicy', 'guardrails'],
//             properties: {
//                 promptContract: { type: 'string' },
//                 contextLayers: { type: 'array', items: { type: 'string' } },
//                 compressionPolicy: { type: 'array', items: { type: 'string' } },
//                 guardrails: { type: 'array', items: { type: 'string' } }
//             }
//         },
//         allowedTools: ['searchKnowledge', 'composeContextPack'],
//         knowledgeScopes: ['architecture', 'standards', 'sdk']
//     }
// ];

const skills = skillDefinitions;

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
    },
    {
        title: 'AI 研发效能落地手册',
        tags: ['copilot', 'standards', 'sdk'],
        content:
            'AI 进入研发流程应从需求澄清、代码生成、单测生成、接口 Mock、文档生成、PR 检查和知识库检索切入。团队落地需要定义任务模板、质量门禁、人工确认、采纳率、返工率和缺陷逃逸率指标。'
    },
    {
        title: 'AI Native 前端交互规范',
        tags: ['copilot', 'architecture', 'ai-native'],
        content:
            'AI Native 前端体验需要支持多轮对话、流式反馈、停止和重试、工具调用状态、引用来源、人工确认、结果修订、执行轨迹和可恢复上下文。复杂输出应以文本、代码、文档、Trace、表格等 Artifact 形式组织。'
    },
    {
        title: 'Context Engineering 设计规范',
        tags: ['copilot', 'architecture', 'standards'],
        content:
            '上下文工程应区分系统指令、用户意图、会话记忆、RAG 引用、工具结果和安全约束。上下文拼接需要定义优先级、token 预算、压缩策略、去重策略、引用保真和敏感信息隔离。'
    },
    {
        title: '需求到交付 Agent 产品设计指南',
        tags: ['copilot', 'architecture', 'ai-native', 'standards'],
        content: `需求到交付 Agent 是面向产研团队的 AI 工作流产品。
                核心功能：需求澄清 → RAG 上下文检索 → PRD 生成 → 页面原型设计 → BFF API 协议 → 研发任务拆解 → 测试策略 → 上线风险评估 → 人工确认。
                页面结构：需求输入区、AI 流式分析区、Artifact 工作台、审计栏。
                BFF API：POST /api/delivery/run（创建交付流）、GET /api/delivery/runs/:id（查询状态）、POST /api/delivery/runs/:id/approve（审批）。
                测试策略：意图识别准确率、RAG 引用命中率、Artifact 完整度、Provider 可用性、HITL 审批流转。
                上线风险：LLM 幻觉、知识库过期、权限越界、成本失控。`
    },
    {
        title: 'B 端 SaaS 产品 PRD 设计规范',
        tags: ['copilot', 'architecture', 'standards'],
        content: `B 端 SaaS PRD 应包含：产品定位、目标用户、核心场景、功能模块、权限模型、数据模型、接口协议、非功能需求、验收标准。
                页面结构遵循：列表-详情-设置三段式，支持多角色视图切换。
                API 设计遵循 RESTful 或 RPC 风格，需有版本管理、限流、审计。
                测试策略：单元测试、集成测试、E2E、性能测试、安全测试。
                上线风险：数据迁移、权限割接、灰度发布、回滚预案。`
    },
    {
        title: 'B 端 SaaS 客户管理后台产品设计',
        tags: ['copilot', 'business', 'saas', 'crm'],
        content: 'B 端 SaaS 客户管理后台典型页面：1) 客户档案管理 - 客户列表、客户详情、联系人管理、客户标签、操作审计；2) 跟进记录 - 跟进时间线、跟进表单、附件上传、跟进提醒；3) 销售漏斗 - 漏斗看板、阶段拖拽、转化率统计、预期金额；4) 团队协作 - 权限管理、操作日志、消息通知、任务分配。典型 API：GET/POST /api/customers、GET/POST /api/follow-ups、GET /api/sales-pipeline、POST /api/permissions。'
    },
    {
        title: '智能客服知识库产品设计',
        tags: ['copilot', 'business', 'knowledge', 'service'],
        content: '智能客服知识库典型页面：1) 问答接待台 - 问题输入、流式答案、引用卡片、低置信度提示、转人工入口；2) 知识库管理 - 文档上传、分组标签、向量索引状态、失效知识提醒、灰度发布；3) 质检反馈台 - 答案采纳、人工纠错、未解决问题池、命中率统计、知识缺口分析；4) 运营看板 - 命中率、未解决率、人工接管率、高频问题、质检通过率。典型 API：POST /api/knowledge/search、POST /api/conversations/:id/messages、POST /api/knowledge/feedback。'
    },
    {
        title: '投研报告生成工作台产品设计',
        tags: ['copilot', 'business', 'research', 'report'],
        content: '投研报告生成工作台典型页面：1) 资料导入区 - 研报上传、公司/行业标签、资料解析状态、引用质量检查；2) 报告生成区 - 大纲生成、章节草稿、引用定位、风险提示、模型选择；3) 合规复核区 - 投资建议标记、敏感表述检查、引用缺失检查、人工审批；4) 报告导出区 - Markdown 导出、PDF 导出、审计记录、版本对比。典型 API：POST /api/research/upload、POST /api/research/generate、POST /api/research/compliance-review。'
    }

];

const knowledgeTemplates = seedKnowledge.map((item, index) => ({
    id: `template-${index + 1}`,
    title: item.title,
    description: item.content.slice(0, 72),
    tags: item.tags,
    content: item.content
}));

const evalCases = [
    {
        id: 'eval-product-workflow',
        title: 'AI 产品工作流',
        modeId: 'product-workflow',
        expected: ['PRD 摘要完整', 'API Contract 合理', 'Trace 可复盘', '引用来源可追溯'],
        form: {
            businessRequirement: '建设一个面向研发团队的 AI 工作流产品，支持业务需求输入、RAG 上下文检索、SSE 流式分析、Artifact 产物和人工确认。',
            targetUsers: '产品经理、前端工程师、后端工程师、技术负责人',
            deliveryGoal: '一周内完成可演示 MVP，输出 PRD、页面结构、接口协议、任务拆解和风险确认点。',
            constraints: '必须展示引用来源、chunk score、Agent Trace、Provider fallback 和 Human-in-the-loop。'
        }
    },
    {
        id: 'eval-customer-kb',
        title: '智能客服知识库',
        modeId: 'product-workflow',
        expected: ['知识库范围清楚', '页面原型覆盖会话与引用', 'API 包含检索和反馈', '风险包含幻觉治理'],
        form: {
            businessRequirement: '为企业内部客服团队建设智能问答知识库，支持文档上传、问题检索、答案引用、会话历史、人工纠错和知识命中质量评估。',
            targetUsers: '客服运营、质检人员、知识库管理员、客服主管',
            deliveryGoal: '两周内完成可用版本，覆盖问答面板、知识库管理、引用来源、质检反馈和运营指标。',
            constraints: '回答必须展示引用来源；低置信度进入人工确认；支持知识库灰度、命中率和未解决问题统计。'
        }
    },
    {
        id: 'eval-research-report',
        title: '投研报告生成工作台',
        modeId: 'product-workflow',
        expected: ['业务边界明确', '页面结构覆盖资料/生成/审阅', '接口协议有审计字段', 'Trace 支持合规复核'],
        form: {
            businessRequirement: '建设投研报告生成工作台，支持上传研报资料、检索公司与行业知识、生成报告大纲、输出章节草稿、展示引用来源并进入人工复核。',
            targetUsers: '投研分析师、研究助理、合规审核、业务负责人',
            deliveryGoal: '完成一个端到端 Demo，覆盖资料导入、RAG 检索、章节生成、引用校验、合规审核和导出。',
            constraints: '不得无引用生成关键结论；所有投资建议类内容必须标记风险并进入人工确认；Trace 需要保留模型、检索和审批记录。'
        }
    }
];

function normalizeSession (session) {
    if (!session) return session;
    const seen = new Set();
    const messages = Array.isArray(session.messages)
        ? session.messages
            .filter((message) => message?.role && String(message.content || '').trim())
            .filter((message) => {
                const key = [message.id || '', message.role, String(message.content || '').trim()].join('::');
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
        : [];
    return { ...session, messages };
}

function normalizeSessions (sessions) {
    return sessions
        .map(normalizeSession)
        .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
}

const projectKnowledgeFiles = [
    {
        title: '真实项目 README 架构文档',
        relativePath: 'README.md',
        tags: ['copilot', 'architecture', 'standards', 'project-file']
    },
    {
        title: '根工作区 package 配置',
        relativePath: 'package.json',
        tags: ['copilot', 'standards', 'project-file']
    },
    {
        title: '前端 client package 配置',
        relativePath: 'client/package.json',
        tags: ['copilot', 'frontend', 'standards', 'project-file']
    },
    {
        title: '后端 server package 配置',
        relativePath: 'server/package.json',
        tags: ['copilot', 'backend', 'standards', 'project-file']
    },
    {
        title: 'Copilot 工作台前端源码',
        relativePath: 'client/src/modules/copilot/CopilotWorkbench.tsx',
        tags: ['copilot', 'frontend', 'architecture', 'ai-native', 'project-file']
    },
    {
        title: 'Copilot BFF 路由源码',
        relativePath: 'server/src/routes/copilot.js',
        tags: ['copilot', 'backend', 'architecture', 'project-file']
    },
    {
        title: 'RAG Engine 检索实现源码',
        relativePath: 'server/src/services/ragEngine.js',
        tags: ['copilot', 'architecture', 'standards', 'project-file']
    },
    {
        title: 'MongoDB Vector Store 实现源码',
        relativePath: 'server/src/store/mongoStore.js',
        tags: ['copilot', 'architecture', 'backend', 'project-file']
    },
    {
        title: 'LLM Provider 接入源码',
        relativePath: 'server/src/services/llmProvider.js',
        tags: ['copilot', 'architecture', 'sdk', 'project-file']
    },
    {
        title: 'MCP Server POC 源码',
        relativePath: 'server/src/mcp/architectureMcpServer.js',
        tags: ['copilot', 'architecture', 'sdk', 'project-file']
    }
];

function now () {
    return new Date().toISOString();
}

function tokenCount (text) {
    return Math.max(12, Math.ceil(String(text || '').length / 1.8));
}

function step (id, name, status, extra = {}) {
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

function runStatus (status, label, extra = {}) {
    return {
        status,
        label,
        at: now(),
        ...extra
    };
}

function uniqueByTitle (documents) {
    const seen = new Set();
    return documents.filter((doc) => {
        if (seen.has(doc.title)) return false;
        seen.add(doc.title);
        return true;
    });
}

function classifyAtlasConnectionFailure (errorMessage = '') {
    const lower = String(errorMessage || '').toLowerCase();
    if (lower.includes('tlsv1 alert internal error') || lower.includes('ssl3_read_bytes')) {
        return {
            code: 'atlas_tls_rejected',
            reason: 'MongoDB Atlas TLS 握手被拒，通常是 Atlas Network Access IP 白名单、代理/VPN 或集群访问策略问题。',
            action: '到 Atlas Network Access 添加当前公网 IP，确认 Database Access 用户有 readWrite 权限，然后重启后端。'
        };
    }
    if (lower.includes('authentication failed')) {
        return {
            code: 'atlas_auth_failed',
            reason: 'MongoDB Atlas 用户名或密码认证失败。',
            action: '检查 MONGODB_ATLAS_URI 中的用户名、密码和 Database Access 权限。'
        };
    }
    if (lower.includes('querysrv') || lower.includes('enotfound') || lower.includes('econnrefused')) {
        return {
            code: 'atlas_network_unreachable',
            reason: '当前机器无法解析或连接 MongoDB Atlas 地址。',
            action: '检查本机网络、DNS、代理/VPN 和 Atlas 集群状态。'
        };
    }
    return {
        code: 'atlas_connection_failed',
        reason: '后端无法连接 MongoDB Atlas，已降级到本地 RAG fallback。',
        action: '检查 MONGODB_ATLAS_URI、Atlas IP 白名单、用户权限和集群状态。'
    };
}

async function inspectVectorStore (store) {
    const checks = {
        requestedBackend: config.ragBackend,
        expectedVectorStore: getRagStatus({ storeKind: store.kind }).vectorStore,
        storeKind: store.kind,
        mongoConnected: store.kind === 'mongo',
        chunks: typeof store.countChunks === 'function' ? await store.countChunks() : undefined,
        index: config.ragBackend === 'mongodb-atlas' ? config.ragVectorIndex : undefined,
        vectorPath: config.ragBackend === 'mongodb-atlas' ? config.ragVectorPath : undefined,
        dimensions: config.ragVectorDimensions
    };

    if (config.ragBackend !== 'mongodb-atlas') {
        return {
            ok: false,
            live: false,
            status: getRagStatus({ storeKind: store.kind, error: 'RAG_BACKEND is not mongodb-atlas.' }),
            checks,
            message: '当前未启用 MongoDB Atlas Vector Search。请设置 RAG_BACKEND=mongodb-atlas，并配置 MONGODB_ATLAS_URI 或 Atlas 版 MONGODB_URI。'
        };
    }

    if (!config.mongodbAtlasConfigured) {
        return {
            ok: false,
            live: false,
            status: getRagStatus({ storeKind: store.kind, vectorSearchReady: false, error: 'Missing MongoDB Atlas mongodb+srv URI.' }),
            checks: { ...checks, connectionError: 'MONGODB_ATLAS_URI is empty or MONGODB_URI is not mongodb+srv://.' },
            message: '已启用 mongodb-atlas，但没有配置 MongoDB Atlas 连接串。请填写 MONGODB_ATLAS_URI=mongodb+srv://...'
        };
    }

    if (store.kind !== 'mongo') {
        const failure = classifyAtlasConnectionFailure(store.connectionError);
        return {
            ok: false,
            live: false,
            status: getRagStatus({ storeKind: store.kind, vectorSearchReady: false, error: store.connectionError || 'MongoDB store is unavailable.' }),
            checks: { ...checks, connectionError: store.connectionError, failureCode: failure.code },
            failure,
            message: `${failure.reason} ${failure.action}`
        };
    }

    try {
        const vectorSearch = await store.checkVectorSearch();

        // checkVectorSearch 返回 ok: false 时（有详细错误）
        if (!vectorSearch.ok) {
            const ragStatus = getRagStatus({
                storeKind: store.kind,
                mode: 'fallback',
                vectorSearchReady: false,
                error: vectorSearch.error
            });
            return {
                ok: false,
                live: false,
                ...ragStatus,
                status: ragStatus,
                checks: { ...checks, vectorSearch },
                message: `Atlas Vector Search 不可用：${vectorSearch.error}`
            };
        }

        // 成功
        const ragStatus = getRagStatus({
            storeKind: store.kind,
            mode: 'live',
            vectorSearchReady: true
        });
        return {
            ok: true,
            live: true,
            ...ragStatus,
            status: ragStatus,
            checks: { ...checks, vectorSearch },
            message: 'MongoDB Atlas Vector Search 已连接，$vectorSearch 可执行。'
        };
    } catch (error) {
        const ragStatus = getRagStatus({
            storeKind: store.kind,
            mode: 'fallback',
            vectorSearchReady: false,
            error: error.message
        });
        return {
            ok: false,
            live: false,
            ...ragStatus,
            status: ragStatus,
            checks: { ...checks, vectorSearch: { ok: false, error: error.message } },
            message: `MongoDB 已连接，但 Atlas Vector Search 不可用：${error.message}`
        };
    }
}

async function readProjectKnowledgeFiles () {
    const documents = [];
    for (const item of projectKnowledgeFiles) {
        const absolutePath = path.resolve(PROJECT_ROOT, item.relativePath);
        if (!absolutePath.startsWith(PROJECT_ROOT)) continue;
        try {
            const raw = await fs.readFile(absolutePath, 'utf8');
            const content = [
                `Source file: ${item.relativePath}`,
                `Indexed at: ${now()}`,
                '',
                raw.slice(0, 60000)
            ].join('\n');
            documents.push({
                title: item.title,
                tags: item.tags,
                content,
                sourceType: 'project-file',
                sourcePath: item.relativePath,
                sourceUpdatedAt: now()
            });
        } catch (error) {
            console.warn(`[knowledge] skip project file ${item.relativePath}: ${error.message}`);
        }
    }
    return documents;
}

async function ensureKnowledge (store) {
    const docs = await store.listDocuments();
    const titles = new Set(docs.map((doc) => doc.title));
    const projectDocs = await readProjectKnowledgeFiles();
    for (const doc of projectDocs) {
        if (!titles.has(doc.title)) {
            await store.createDocument(doc);
            titles.add(doc.title);
        }
    }
    for (const doc of seedKnowledge) {
        if (!titles.has(doc.title)) await store.createDocument({ ...doc, sourceType: 'template' });
    }
}

async function searchKnowledgeWithStatus (store, query, scopes) {
    return retrieveKnowledge({ store, query, scopes, limit: 5 });
}

async function analyzeRepository ({ skillId, mode }) {
    const focusMap = {
        'engineering-productivity': ['代码生成', '测试辅助', '文档生成', 'PR 质量门禁'],
        'requirement-analysis': ['业务目标完整性', '约束可验证性', '验收标准'],
        'architecture-review': ['模块边界', '数据流', '可观测性', '发布风险'],
        'code-review': ['变更风险', '测试缺口', '性能与可维护性'],
        'context-engineering': ['上下文分层', 'RAG 拼接', '压缩策略', '幻觉防护']
    };
    return {
        stack: ['React', 'TypeScript', 'Less', 'Node.js', 'MongoDB', 'SSE', 'MCP POC'],
        modules: ['copilot-workbench', 'skill-runtime', 'tool-registry', 'rag-engine', 'context-engine', 'human-review', 'agent-trace'],
        focus: focusMap[skillId] || focusMap['architecture-review'],
        mode,
        risks: ['缺少真实 LLM Provider 时需要 mock provider 边界', 'PDF 文本抽取在 MVP 中采用轻量兼容策略'],
        recommendation: '保持工具接口稳定，后续可替换为 MCP Server 或 OpenAI Agents SDK tools。'
    };
}

function generateEngineeringArtifacts ({ prompt, skill, sources, repoAnalysis }) {
    return [
        {
            id: 'artifact-code-scaffold',
            type: 'code',
            title: '组件生成草案',
            language: 'tsx',
            content: [
                'type ReviewPanelProps = {',
                '  title: string;',
                '  findings: string[];',
                '  onApprove: () => void;',
                '};',
                '',
                'export function ReviewPanel(props: ReviewPanelProps) {',
                '  return <section aria-label={props.title}>{props.findings.map((item) => <p key={item}>{item}</p>)}</section>;',
                '}'
            ].join('\n')
        },
        {
            id: 'artifact-test-plan',
            type: 'test',
            title: '智能测试策略',
            content: [
                '1. 为 Skill 切换、SSE 中止、重新生成、人工确认增加交互测试。',
                '2. 为 allowedTools 与 knowledgeScopes 增加契约测试。',
                '3. 为 RAG 引用来源、Trace 顺序和 Provider fallback 增加回归测试。',
                `4. 当前关注技术栈：${repoAnalysis?.stack?.join(' / ') || 'React / Node'}。`
            ].join('\n')
        },
        {
            id: 'artifact-doc',
            type: 'document',
            title: '研发提效落地说明',
            content: [
                '# AI 研发提效方案',
                '',
                `目标：${prompt}`,
                '',
                `Skill：${skill.name} / ${skill.version}`,
                '',
                '落地路径：先从代码生成、单测生成、文档草稿、PR 检查四类低风险任务切入，高风险改动进入人工确认。',
                '',
                `引用：${sources.map((source) => source.documentTitle).join('、') || '暂无'}`
            ].join('\n')
        }
    ];
}

function readPromptField (prompt, label, fallback = '') {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = prompt.match(new RegExp(`${escaped}[：:]\\s*([^\\n]+)`, 'i'));
    return (match?.[1] || fallback).trim();
}

function parseProductWorkflowInput (prompt) {
    return {
        businessRequirement: readPromptField(prompt, '业务需求', prompt.slice(0, 220)),
        targetUsers: readPromptField(prompt, '目标用户', '产品经理、前端工程师、后端工程师、算法工程师、技术负责人'),
        deliveryGoal: readPromptField(prompt, '交付目标', '完成一个可演示、可评审、可拆分研发任务的 AI 产品工作流 MVP'),
        constraints: readPromptField(prompt, '约束条件', 'React + TypeScript + Node BFF + SSE；高风险动作需要人工确认；输出必须可追踪引用来源')
    };
}

function splitList (value) {
    return value
        .split(/[、,，/；;]+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 8);
}

function inferProductScenario (input) {
    const text = [input.businessRequirement, input.targetUsers, input.deliveryGoal, input.constraints].join(' ');
    if (/客服|知识库|问答|质检|未解决|人工纠错/.test(text)) {
        return {
            id: 'customer-kb',
            name: '智能客服知识库',
            entry: '客服知识库问答工作台',
            problem: '客服团队知识分散、答案不可追溯、人工纠错和质检反馈链路不闭环。',
            pages: [
                { name: '问答接待台', modules: ['客户问题输入', '答案流式生成', '引用来源', '低置信度提示', '转人工入口'] },
                { name: '知识库管理', modules: ['文档上传', '分组标签', '向量索引状态', '失效知识提醒', '灰度发布'] },
                { name: '质检反馈台', modules: ['答案采纳', '人工纠错', '未解决问题池', '命中率统计', '知识缺口分析'] },
                { name: '运营看板', modules: ['知识命中率', '未解决率', '人工接管率', '高频问题', '质检通过率'] }
            ],
            apiBase: '/api/copilot/customer-kb',
            apiFields: {
                question: 'string',
                sessionId: 'string',
                knowledgeScopes: ['faq', 'policy', 'operation'],
                requireCitation: true,
                confidenceThreshold: 0.72
            },
            tasks: {
                frontend: ['问答会话面板、引用来源抽屉、低置信度提示和人工纠错表单。', '知识库上传、索引状态、命中质量看板和未解决问题列表。'],
                bff: ['封装 question/retrieve/feedback API，记录答案、引用、置信度和人工纠错。', '接入知识库文档、chunk、向量检索和质检反馈闭环。'],
                qa: ['准备 FAQ、政策类、边界类问题，验证引用准确性和低置信度转人工。']
            },
            risks: ['知识库过期导致错误回答，需要失效提醒和版本灰度。', '低分 chunk 被模型误用，需要引用阈值和答案置信度。', '人工纠错不回流会导致同类问题重复失败。']
        };
    }
    if (/投研|研报|报告|合规|章节|投资|行业|公司/.test(text)) {
        return {
            id: 'research-report',
            name: '投研报告生成工作台',
            entry: '投研报告生成与复核工作台',
            problem: '研报资料来源多、章节协同成本高、引用和合规复核需要完整留痕。',
            pages: [
                { name: '资料导入区', modules: ['研报上传', '公司/行业标签', '资料解析状态', '引用质量检查'] },
                { name: '报告生成区', modules: ['大纲生成', '章节草稿', '引用定位', '风险提示', '模型选择'] },
                { name: '合规复核区', modules: ['投资建议标记', '敏感表述检查', '引用缺失检查', '人工审批'] },
                { name: '报告导出区', modules: ['Markdown 导出', 'PDF 导出', '审计记录', '版本对比'] }
            ],
            apiBase: '/api/copilot/research-report',
            apiFields: {
                reportTopic: 'string',
                companyCodes: ['string'],
                sourceDocumentIds: ['string'],
                requireCitation: true,
                complianceReview: true
            },
            tasks: {
                frontend: ['资料上传与解析状态、章节编辑器、引用定位和合规复核面板。', '报告 Artifact 支持章节预览、版本对比、导出和审批流。'],
                bff: ['封装资料解析、RAG 检索、章节生成、合规规则和审计 Trace API。', '所有投资建议类段落必须关联引用来源和人工确认记录。'],
                qa: ['准备公司事实、行业趋势、风险提示三类 Eval，检查引用缺失和合规标记。']
            },
            risks: ['无引用生成投资结论会形成合规风险。', '行业知识和公司资料时效性强，需要来源时间和版本标记。', '模型生成内容需要人工复核后才能导出。']
        };
    }
    return {
        id: 'ai-product-workflow',
        name: 'AI 产品工作流',
        entry: 'AI 产品工作流工作台',
        problem: '业务需求、页面设计、接口协同、研发拆解和人工确认分散在不同工具中，缺少可追踪闭环。',
        pages: [
            { name: '需求输入区', modules: ['业务需求', '目标用户', '交付目标', '约束条件', 'Prompt Contract', '模型选择'] },
            { name: 'AI 流式分析区', modules: ['需求摘要', '用户角色拆解', '业务流程', '页面模块', '失败降级提示'] },
            { name: 'Artifact 工作台', modules: ['PRD 文档规范', '页面流程与原型结构', '接口协议草案', '研发任务拆解', '风险和待确认问题'] },
            { name: '右侧审计栏', modules: ['Agent Trace', 'RAG 引用来源', '人工确认节点', '审批历史'] }
        ],
        apiBase: '/api/copilot/product-workflow',
        apiFields: {
            businessRequirement: 'string',
            targetUsers: 'string',
            deliveryGoal: 'string',
            constraints: 'string',
            requireCitation: true
        },
        tasks: {
            frontend: ['实现结构化需求输入、模型选择、流式输出、Artifact 面板、引用来源和人工确认交互。', 'Agent Trace 支持节点展开、路径还原、失败态和多节点审计详情。'],
            bff: ['实现会话、SSE、RAG 检索、工具调用、审批状态和错误恢复。', '统一 LLM Provider Adapter，支持 DeepSeek / OpenAI-compatible / fallback。'],
            qa: ['覆盖停止生成、重新生成、Provider 失败、引用为空、审批拒绝和重新执行。']
        },
        risks: ['LLM Provider 余额、限流或网络异常会影响流式生成，需要 fallback 和错误提示。', 'RAG 检索质量依赖知识库覆盖度，需要展示 score、sourcePath 和引用片段。', '高风险动作必须进入人工确认。']
    };
}

function generateProductWorkflowArtifacts ({ prompt, skill, sources }) {
    const input = parseProductWorkflowInput(prompt);
    const scenario = inferProductScenario(input);
    const citations = sources.map((source, index) => `[${index + 1}] ${source.documentTitle}`).join('、') || '暂无引用';
    const sourceEvidence = sources.slice(0, 5).map((source, index) => `- [${index + 1}] ${source.documentTitle} / ${source.scope || 'unknown'} / score ${Number(source.score || 0).toFixed(4)}`).join('\n') || '- 当前未命中知识库引用，需补充项目规范或业务文档。';
    const targetUsers = splitList(input.targetUsers);
    const constraints = splitList(input.constraints);
    return [
        {
            id: `artifact-${scenario.id}-prd-summary`,
            type: 'prd',
            title: `${scenario.name} PRD`,
            content: [
                `# ${scenario.name} PRD`,
                '',
                '## 1. 背景与问题',
                `${input.businessRequirement}`,
                '',
                `业务痛点：${scenario.problem}`,
                '',
                '## 2. 产品目标',
                `- ${input.deliveryGoal}`,
                `- 建设 ${scenario.entry}，将业务输入转成可评审的产品规格、页面方案、接口协议和研发任务。`,
                '- 让 AI 生成过程可追踪、可解释、可人工确认，而不是只输出一段聊天文本。',
                '',
                '## 3. 目标用户',
                ...(targetUsers.length ? targetUsers.map((user) => `- ${user}`) : ['- 产品经理', '- 前端工程师', '- 后端工程师', '- 算法工程师']),
                '',
                '## 4. 功能范围',
                ...scenario.pages.map((page) => `- ${page.name}：${page.modules.join('、')}。`),
                '- AI 分析：按 Skill Definition 校验输入，按 knowledgeScopes 组织上下文。',
                '- RAG 引用：展示命中的 chunk、score、来源和引用摘要。',
                '- Artifact 生成：PRD、页面结构、API Contract、状态流转、任务拆解和风险清单。',
                '- 人工确认：对高风险输出支持确认、修改后确认、拒绝和审计留痕。',
                '',
                '## 5. 约束与规则',
                ...(constraints.length ? constraints.map((rule) => `- ${rule}`) : ['- 需要前后端分离，接口协议清晰。', '- 需要支持 SSE 流式反馈。', '- 高风险动作必须进入人工确认。']),
                '',
                '## 6. 验收标准',
                '- 页面结构、接口协议、状态流转和任务拆解同时输出。',
                '- 每个关键结论可以追溯到 RAG 引用或用户输入。',
                '- 生成结果可编辑、可确认、可拒绝。',
                '- Trace 至少覆盖用户请求、Skill 选择、Provider 检查、RAG 检索、Tool 调用、LLM 输出、结构化结果和人工确认。',
                '',
                '## 7. 引用依据',
                sourceEvidence
            ].join('\n')
        },
        {
            id: `artifact-${scenario.id}-ui-flow`,
            type: 'flow',
            title: `${scenario.name} 页面结构`,
            content: {
                productGoal: input.deliveryGoal,
                entry: scenario.entry,
                pages: scenario.pages,
                interactionRules: [
                    '输入区只负责收集结构化需求和约束，不直接生成最终结论。',
                    '中间流式区展示 AI 推理过程和降级信息，避免用户误以为系统卡死。',
                    '右侧审计栏展示每一步输入输出，支持节点展开，满足可解释和复盘。',
                    'Artifact 产物用于跨角色评审，确认后再进入研发任务。'
                ],
                stateFlow: ['idle', 'validating', 'retrieving', 'tool_running', 'streaming', 'waiting_approval', 'completed'],
                mobileAdaptation: ['核心输入字段堆叠展示', 'Trace 收起为底部抽屉', 'Artifact 卡片单列展示']
            }
        },
        {
            id: `artifact-${scenario.id}-api-contract`,
            type: 'api',
            title: `${scenario.name} 接口协议`,
            language: 'json',
            content: {
                [`POST ${scenario.apiBase}/run`]: {
                    request: {
                        ...scenario.apiFields,
                        skillId: skill.id,
                        model: { provider: 'deepseek | openai-compatible | dashscope', model: 'string' }
                    },
                    response: {
                        traceId: 'string',
                        artifacts: ['prd', 'flow', 'api', 'task', 'risk'],
                        approvalId: 'string',
                        citations: sources.map((source) => ({
                            title: source.documentTitle,
                            scope: source.scope,
                            score: source.score
                        }))
                    }
                },
                [`GET ${scenario.apiBase}/trace/:traceId`]: {
                    response: ['request', 'retrieval', 'tool_running', 'streaming', 'waiting_approval']
                }
            }
        },
        {
            id: `artifact-${scenario.id}-task-breakdown`,
            type: 'task',
            title: `${scenario.name} 研发任务`,
            content: [
                '# 研发任务拆解',
                '',
                '## Frontend',
                ...scenario.tasks.frontend.map((task) => `- ${task}`),
                '',
                '## Node BFF',
                ...scenario.tasks.bff.map((task) => `- ${task}`),
                '',
                '## AI / Prompt / Context',
                '- 定义 SkillDefinition：inputSchema、outputSchema、allowedTools、knowledgeScopes。',
                '- 构建 Context Pack：用户需求、RAG 引用、工具状态、人工确认策略。',
                '- 对 Provider 失败、引用不足、输出不满足 Schema 做降级和提示。',
                '',
                '## QA',
                ...scenario.tasks.qa.map((task) => `- ${task}`),
                '- 检查引用命中率、Artifact 完整度、Trace 可复盘和人工确认闭环。',
                '',
                `引用来源：${citations}`
            ].join('\n')
        },
        {
            id: `artifact-${scenario.id}-risk-open-questions`,
            type: 'risk',
            title: `${scenario.name} 风险与确认`,
            content: [
                '# 风险和待确认问题',
                '',
                '## 主要风险',
                ...scenario.risks.map((risk) => `- ${risk}`),
                '',
                '## 待确认问题',
                `- ${scenario.name} 的首批用户和验收负责人是谁？`,
                '- 是否需要将生成结果同步到文档系统、任务系统或代码仓库？',
                '- 哪些输出属于高风险内容，必须进入人工确认？',
                '- Eval 指标优先看引用命中率、采纳率、生成稳定性还是任务节省时长？',
                '',
                `引用来源：${citations}`
            ].join('\n')
        }
    ];
}

function composeContextPack ({ prompt, skill, sources }) {
    return {
        id: 'artifact-context-pack',
        type: 'context',
        title: 'Context Pack',
        content: {
            goal: prompt,
            skill: { id: skill.id, version: skill.version },
            layers: [
                { name: 'system', priority: 1, policy: '稳定角色、输出结构、风险边界' },
                { name: 'user', priority: 2, policy: '保留原始意图和结构化表单字段' },
                { name: 'retrieval', priority: 3, policy: '只注入与 knowledgeScopes 命中的引用片段' },
                { name: 'tools', priority: 4, policy: '只拼接 allowedTools 的输入输出摘要' },
                { name: 'memory', priority: 5, policy: '保留最近会话决策，超过 token 预算时压缩' }
            ],
            guardrails: ['引用来源必须展示', '工具越权不执行', '高风险动作进入人工确认', 'Provider 失败可降级']
        }
    };
}

function generateArchitectureDocument ({ prompt, skill, sources }) {
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

function buildAnswer ({ prompt, skill, sources, repoAnalysis, documentDraft, artifacts = [] }) {
    const sourceText = sources.map((source, index) => `[${index + 1}] ${source.documentTitle}: ${source.content}`).join('\n');
    const toolText = [
        `searchKnowledge 命中 ${sources.length} 条上下文`,
        repoAnalysis ? `analyzeRepository 识别重点：${repoAnalysis.focus.join(' / ')}` : '',
        documentDraft ? 'generateArchitectureDocument 已生成草稿，等待人工确认' : '',
        artifacts.length ? `生成 ${artifacts.length} 个 Artifact，用于代码、测试、文档或上下文展示` : ''
    ].filter(Boolean).join('。\n- ');
    const skillSpecific = {
        'engineering-productivity': `### 研发提效方案
- 切入点：代码生成、测试辅助、文档生成、PR 检查，先做低风险自动化，再进入高风险人工确认。
- 团队机制：沉淀任务模板、Prompt 规范、质量门禁和采纳率指标。
- 前端实现：用流式反馈展示生成过程，用 Artifact 区分代码、测试、文档和 Trace，用审批节点兜底风险。
- 成效指标：PR 周期、单测覆盖率、缺陷逃逸率、文档补全率、AI 建议采纳率。`,
        'requirement-analysis': `### 需求拆解
- 业务目标：${prompt}
- 关键约束：需要把输入 Schema、输出 Schema、知识域、工具权限和人工确认写入验收标准。
- 验收标准：多会话可恢复、SSE 可停止、RAG 有引用、Trace 可还原、审批可确认/修改/拒绝。
- 待确认问题：是否接入真实 LLM Provider、是否需要团队权限分层、PDF 正文抽取是否进入本期。`,
        'architecture-review': `### 架构评审
- 决策：建议通过 MVP 评审，但需要把 Trace 路径还原、RAG 模板导入和 Skill/Tool 权限绑定作为交付门槛。
- 模块边界：React Workbench 负责交互，Node BFF 负责鉴权、Skill Runtime、RAG、Tool Calling 和审批持久化。
- 风险：工具调用若不受 allowedTools 约束，会造成审计失真；知识库若无引用展示，会退化为普通聊天。
- 演进：后续将普通函数工具迁移到 MCP Server，并接入真实 Embedding / Vector DB。`,
        'code-review': `### Code Review
- Findings：当前改动重点应检查前端模块边界、SSE 中止、Trace 状态一致性和审批持久化。
- Test Gaps：需要覆盖不同 Skill 的 allowedTools、知识域过滤、模板导入去重和流式中断。
- Recommendation：允许进入 MVP，但合并前必须跑 typecheck、lint、build 和 Node 语法检查。`,
        'context-engineering': `### Context Engineering
- Prompt Contract：系统指令负责边界，用户输入负责目标，结构化表单负责约束，RAG 负责事实，工具结果负责状态。
- Context Layers：system / user / retrieval / tools / memory / guardrails 分层拼接。
- Compression：优先保留决策、引用来源、工具输出摘要，压缩长对话和重复片段。
- Guardrails：知识域隔离、引用展示、工具权限、人工确认和 Provider fallback。`
    };
    return `## ${skill.name} 输出

我会按 **${skill.description}** 处理你的请求。

${skillSpecific[skill.id] || skillSpecific['architecture-review']}

### 工具结果
- ${toolText}

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

function normalizeForm (form = {}) {
    return Object.entries(form)
        .filter(([, value]) => String(value || '').trim())
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');
}

export function copilotRouter (store) {
    const router = express.Router();

    router.use(async (req, res, next) => {
        await ensureKnowledge(store);
        next();
    });

    router.get('/skills', (req, res) => {
        const validated = skills.map((skill) => ({ ...skill, validation: validateSkill(skill) }));
        res.json({
            skills: validated,
            provider: getProviderStatus(),
            rag: getRagStatus({ storeKind: store.kind, error: store.connectionError })
        });
        // res.json({ skills, provider: getProviderStatus(), rag: getRagStatus({ storeKind: store.kind, error: store.connectionError }) });
    });

    router.get('/runtime', (req, res) => {
        res.json({
            llm: getProviderStatus(),
            rag: getRagStatus({ storeKind: store.kind, error: store.connectionError }),
            mcp: {
                enabled: true,
                transport: 'stdio-jsonrpc',
                command: 'node server/src/mcp/architectureMcpServer.js'
            }
        });
    });

    router.get('/vector-store/health', async (req, res) => {
        res.json(await inspectVectorStore(store));
    });

    router.get('/models', (req, res) => {
        res.json({
            active: getProviderStatus(),
            models: getModelPresets()
        });
    });

    router.get('/eval-cases', (req, res) => {
        res.json({ cases: evalCases });
    });

    router.get('/knowledge/templates', (req, res) => {
        res.json({ templates: knowledgeTemplates });
    });

    router.get('/sessions', async (req, res) => {
        // 列表接口不返回 messages，详情接口再返回
        const sessions = await store.listRecords('copilot_sessions', 50, { messages: 0 });
        res.json({ sessions: normalizeSessions(sessions) });
    });

    router.post('/sessions', async (req, res) => {
        const session = await store.createRecord('copilot_sessions', {
            title: req.body.title || '新的架构会话',
            messages: [],
            createdBy: req.user._id,
            activeSkillId: req.body.skillId || 'architecture-review'
        });
        res.json({ session: normalizeSession(session) });
    });

    router.get('/sessions/:id', async (req, res) => {
        const session = await store.getRecord('copilot_sessions', req.params.id);
        res.json({ session: normalizeSession(session) });
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
            sourceType: 'upload',
            sourcePath: filename,
            content: text || '空文档'
        });
        res.json({ document });
    });

    router.post('/knowledge/project/import', async (req, res) => {
        const docs = await store.listDocuments();
        const titles = new Set(docs.map((doc) => doc.title));
        const projectDocs = await readProjectKnowledgeFiles();
        const imported = [];
        const skipped = [];
        for (const doc of projectDocs) {
            if (titles.has(doc.title)) {
                skipped.push(doc);
                continue;
            }
            const created = await store.createDocument(doc);
            imported.push(created);
            titles.add(doc.title);
        }
        res.json({
            imported,
            skipped: skipped.map((doc) => ({ title: doc.title, sourcePath: doc.sourcePath })),
            totalProjectFiles: projectDocs.length
        });
    });

    router.post('/knowledge/templates/:id/import', async (req, res) => {
        const template = knowledgeTemplates.find((item) => item.id === req.params.id);
        if (!template) {
            res.status(404).json({ message: 'Knowledge template not found' });
            return;
        }
        const document = await store.createDocument({
            title: template.title,
            tags: template.tags,
            sourceType: 'template',
            content: template.content
        });
        res.json({ document });
    });

    router.get('/knowledge', async (req, res) => {
        const documents = uniqueByTitle((await store.listDocuments()).filter((doc) => (doc.tags || []).includes('copilot')))
            .sort((a, b) => {
                const rank = { 'project-file': 0, upload: 1, template: 2, manual: 3 };
                return (rank[a.sourceType] ?? 4) - (rank[b.sourceType] ?? 4);
            });
        res.json({
            documents,
            stats: {
                projectFiles: documents.filter((doc) => doc.sourceType === 'project-file').length,
                uploads: documents.filter((doc) => doc.sourceType === 'upload').length,
                templates: documents.filter((doc) => doc.sourceType === 'template' || !doc.sourceType).length,
                chunks: documents.reduce((sum, doc) => sum + (doc.chunkCount || 0), 0)
            }
        });
    });

    router.post('/knowledge/search', async (req, res) => {
        const query = String(req.body.query || '').trim();
        const scopes = Array.isArray(req.body.scopes) && req.body.scopes.length ? req.body.scopes : ['architecture', 'standards'];
        const limit = Number(req.body.limit || 5);
        const startedAt = Date.now();
        const result = await retrieveKnowledge({
            store,
            query: query || scopes.join(' '),
            scopes,
            limit: Number.isFinite(limit) ? limit : 5
        });
        res.json({
            rag: result.status,
            query: query || scopes.join(' '),
            scopes,
            latencyMs: Date.now() - startedAt,
            sources: result.sources
        });
    });

    router.post('/sessions/:id/messages/stream', async (req, res) => {
        initSse(res);
        const session = await store.getRecord('copilot_sessions', req.params.id);
        if (!session) {
            sendEvent(res, 'error', { message: 'Session not found' });
            res.end();
            return;
        }

        const formContext = normalizeForm(req.body.form);
        const prompt = [String(req.body.prompt || '').trim(), formContext ? `\n结构化输入:\n${formContext}` : ''].join('').trim();
        const skill = skills.find((item) => item.id === req.body.skillId) || skills[1];
        const mode = req.body.mode || skill.id;
        const modelConfig = req.body.model && typeof req.body.model === 'object'
            ? {
                provider: req.body.model.provider,
                model: req.body.model.model,
                baseUrl: req.body.model.baseUrl
            }
            : {};
        const providerStatus = getProviderStatus(modelConfig);
        const traceId = `trace-${crypto.randomUUID()}`;
        const userMessage = { id: `user-${Date.now()}`, role: 'user', content: prompt, createdAt: now(), skillId: skill.id };

        const trace = [];
        const emitStep = async (payload) => {
            trace.push(payload);
            sendEvent(res, 'trace', payload);
            await sleep(120);
        };
        const emitRunStatus = (status, label, extra = {}) => {
            sendEvent(res, 'run_status', runStatus(status, label, extra));
        };

        emitRunStatus('validating', '校验输入与选择 Skill');
        await emitStep(step('request', '用户请求', 'success', { input: { prompt }, tokenUsage: tokenCount(prompt) }));
        await emitStep(step('skill', '选择 Skill', 'success', { output: { id: skill.id, version: skill.version } }));
        await emitStep(step('runtime', '检查运行时 Provider', 'success', {
            output: { llm: providerStatus, rag: getRagStatus() }
        }));
        emitRunStatus('retrieving', '检索 RAG 上下文', { scopes: skill.knowledgeScopes });
        await emitStep(step('context', '加载上下文', 'running', { output: { knowledgeScopes: skill.knowledgeScopes } }));
        const knowledgeStartedAt = Date.now();
        const knowledgeResult = await searchKnowledgeWithStatus(store, prompt, skill.knowledgeScopes);
        const knowledgeLatencyMs = Date.now() - knowledgeStartedAt;
        const sources = knowledgeResult.sources;
        await emitStep(step('knowledge', '调用知识库 searchKnowledge', 'success', {
            tool: 'searchKnowledge',
            input: { query: prompt, scopes: skill.knowledgeScopes },
            output: {
                rag: knowledgeResult.status,
                latencyMs: knowledgeLatencyMs,
                sources: sources.map((source) => ({
                    title: source.documentTitle,
                    score: source.score,
                    backend: source.retrievalBackend
                }))
            },
            tokenUsage: tokenCount(JSON.stringify(sources))
        }));
        sendEvent(res, 'sources', {
            rag: knowledgeResult.status,
            query: prompt,
            scopes: skill.knowledgeScopes,
            latencyMs: knowledgeLatencyMs,
            sources
        });

        let repoAnalysis = null;
        emitRunStatus('tool_running', '执行工具与生成 Artifact');
        if (skill.allowedTools.includes('analyzeRepository')) {
            repoAnalysis = await analyzeRepository({ skillId: skill.id, mode });
            await emitStep(step('repo', '调用工具 analyzeRepository', 'success', {
                tool: 'analyzeRepository',
                input: { repository: 'local-workspace', focus: repoAnalysis.focus },
                output: repoAnalysis,
                tokenUsage: 128
            }));
        }

        let documentDraft = '';
        if (skill.allowedTools.includes('generateArchitectureDocument')) {
            documentDraft = generateArchitectureDocument({ prompt, skill, sources });
            await emitStep(step('document', '调用工具 generateArchitectureDocument', 'success', {
                tool: 'generateArchitectureDocument',
                input: { format: 'markdown', requireCitations: true },
                output: { chars: documentDraft.length },
                tokenUsage: tokenCount(documentDraft)
            }));
        }

        let artifacts = [];
        if (skill.allowedTools.includes('generateProductWorkflowArtifacts')) {
            artifacts = generateProductWorkflowArtifacts({ prompt, skill, sources });
            await emitStep(step('product-workflow', '生成产品工作流 Artifacts', 'success', {
                tool: 'generateProductWorkflowArtifacts',
                input: { artifactTypes: ['prd', 'flow', 'api', 'task', 'risk'], requireHumanApproval: true },
                output: artifacts.map((artifact) => ({ type: artifact.type, title: artifact.title })),
                tokenUsage: tokenCount(JSON.stringify(artifacts))
            }));
        }

        if (skill.allowedTools.includes('generateEngineeringArtifacts')) {
            artifacts = [...artifacts, ...generateEngineeringArtifacts({ prompt, skill, sources, repoAnalysis })];
            await emitStep(step('artifacts', '生成研发效能 Artifacts', 'success', {
                tool: 'generateEngineeringArtifacts',
                input: { artifactTypes: ['code', 'test', 'document'] },
                output: artifacts.map((artifact) => ({ type: artifact.type, title: artifact.title })),
                tokenUsage: tokenCount(JSON.stringify(artifacts))
            }));
        }

        if (skill.allowedTools.includes('composeContextPack')) {
            const contextPack = composeContextPack({ prompt, skill, sources });
            artifacts = [...artifacts, contextPack];
            await emitStep(step('context-pack', '构建 Context Pack', 'success', {
                tool: 'composeContextPack',
                input: { sources: sources.map((source) => source.documentTitle), skill: skill.id },
                output: { layers: contextPack.content.layers.length, guardrails: contextPack.content.guardrails.length },
                tokenUsage: tokenCount(JSON.stringify(contextPack))
            }));
        }

        if (artifacts.length) {
            sendEvent(res, 'artifacts', { artifacts });
        }

        const fallbackAnswer = buildAnswer({ prompt, skill, sources, repoAnalysis, documentDraft, artifacts });
        const toolResults = {
            searchKnowledge: sources.map((source) => ({ title: source.documentTitle, score: source.score })),
            analyzeRepository: repoAnalysis,
            generateProductWorkflowArtifacts: artifacts.filter((artifact) => ['prd', 'flow', 'api', 'task', 'risk'].includes(artifact.type)).map((artifact) => ({ type: artifact.type, title: artifact.title })),
            generateArchitectureDocument: documentDraft ? { chars: documentDraft.length } : null,
            artifacts: artifacts.map((artifact) => ({ type: artifact.type, title: artifact.title }))
        };
        const assistantId = `assistant-${Date.now()}`;
        let answer = fallbackAnswer;
        let streamedByProvider = false;
        try {
            emitRunStatus('streaming', '调用 LLM 并流式输出', {
                provider: providerStatus.provider,
                model: providerStatus.requestedModel || providerStatus.model
            });
            await emitStep(step('llm', '调用真实 LLM Provider', 'running', {
                input: { provider: providerStatus.provider, model: providerStatus.requestedModel || providerStatus.model }
            }));
            const generated = await streamLlmAnswer({
                systemPrompt: skill.systemPrompt,
                prompt,
                sources,
                toolResults,
                modelConfig,
                onDelta: (text) => {
                    sendEvent(res, 'delta', { id: assistantId, text });
                }
            });
            if (generated.streamed && generated.text.trim()) {
                answer = generated.text;
                streamedByProvider = true;
            } else {
                const completed = await generateLlmAnswer({
                    systemPrompt: skill.systemPrompt,
                    prompt,
                    sources,
                    toolResults,
                    modelConfig,
                    fallback: fallbackAnswer
                });
                answer = completed.text;
            }
            await emitStep(step('llm', '调用真实 LLM Provider', generated.provider.mode === 'live' ? 'success' : 'success', {
                input: { provider: generated.provider.provider, model: generated.provider.model },
                output: { mode: generated.provider.mode, streaming: generated.streamed },
                tokenUsage: tokenCount(answer)
            }));
        } catch (error) {
            emitRunStatus('failed', 'LLM Provider 失败，执行 fallback', { error: error.message });
            await emitStep(step('llm', '调用真实 LLM Provider', 'failed', {
                input: providerStatus,
                error: error.message
            }));
            answer = `${fallbackAnswer}\n\n### Provider 降级\n真实 LLM 调用失败，当前已降级到本地 deterministic runtime。错误：${error.message}`;
        }
        const approvalDraft = documentDraft || `# ${skill.name} 人工确认草稿\n\n${answer}`;
        await emitStep(step('structured', '生成结构化结果', 'success', { tokenUsage: tokenCount(answer) }));
        emitRunStatus('waiting_approval', '等待人工确认');
        await emitStep(step('human', '等待人工确认', 'waiting', { humanRequired: true }));

        if (!streamedByProvider) {
            for (let index = 0; index < answer.length; index += 18) {
                sendEvent(res, 'delta', { id: assistantId, text: answer.slice(index, index + 18) });
                await sleep(18);
            }
        }

        const approval = await store.createRecord('copilot_approvals', {
            traceId,
            sessionId: req.params.id,
            status: 'pending',
            skillId: skill.id,
            prompt,
            documentDraft: approvalDraft
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

        emitRunStatus('completed', '生成完成，等待用户处理审批');
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
