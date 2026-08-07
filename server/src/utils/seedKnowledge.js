import { createServiceTenantContext } from '../security/tenantContext.js';

export const DEFAULT_TENANT_ID = 'tenant-demo';

export const seedKnowledge = [
    {
        title: '微前端架构设计文档',
        tags: ['copilot', 'architecture', 'micro-frontend'],
        scopes: ['architecture'],
        content:
            '微前端基座需要统一登录态、路由、生命周期、全局事件和灰度发布。Wujie 适合 iframe + WebComponent 沙箱隔离，Qiankun 适合存量生态成熟场景。子应用必须通过 manifest 声明 domain、capabilities、entry 和权限边界。'
    },
    {
        title: 'SDK 规范与工程约束',
        tags: ['copilot', 'sdk', 'standards'],
        scopes: ['sdk', 'standards'],
        content:
            '@company/sdk 必须提供类型定义、错误码、超时、重试、缓存、降级和埋点。禁止在业务模块中直接调用不受控全局变量。CI 需要检查硬编码、翻译覆盖率、类型错误和构建产物大小。'
    },
    {
        title: 'IM 架构文档',
        tags: ['copilot', 'im', 'architecture'],
        scopes: ['architecture'],
        content:
            '在线 IM 使用 WebSocket 承载实时消息，后端需要会话 ID、用户 ID、消息持久化、机器人接待、转人工、重连补偿和审计。高风险内容需要进入人工确认节点，不能由 Agent 自动执行。'
    },
    {
        title: '低代码组件协议',
        tags: ['copilot', 'lowcode', 'architecture'],
        scopes: ['architecture'],
        content:
            '低代码编辑器应采用块式 Document Model，节点和边与渲染层解耦。核心机制包括 Schema、Plugin、Selection、History、Command、Transaction、离线 opLog 和协同合并。'
    },
    {
        title: '项目开发规范',
        tags: ['copilot', 'standards'],
        scopes: ['standards'],
        content:
            '前端必须使用 TypeScript 和 Less，模块需要拆分清晰，公共能力进入 platform。Node BFF 负责鉴权、RAG、工具调用、会话和 Trace。高风险工具必须通过人工确认。'
    },
    {
        title: 'AI 研发效能落地手册',
        tags: ['copilot', 'standards', 'sdk'],
        scopes: ['standards', 'sdk'],
        content:
            'AI 进入研发流程应从需求澄清、代码生成、单测生成、接口 Mock、文档生成、PR 检查和知识库检索切入。团队落地需要定义任务模板、质量门禁、人工确认、采纳率、返工率和缺陷逃逸率指标。'
    },
    {
        title: 'AI Native 前端交互规范',
        tags: ['copilot', 'architecture', 'ai-native'],
        scopes: ['ai-native', 'frontend'],
        content:
            'AI Native 前端体验需要支持多轮对话、流式反馈、停止和重试、工具调用状态、引用来源、人工确认、结果修订、执行轨迹和可恢复上下文。复杂输出应以文本、代码、文档、Trace、表格等 Artifact 形式组织。'
    },
    {
        title: 'Context Engineering 设计规范',
        tags: ['copilot', 'architecture', 'standards'],
        scopes: ['architecture', 'standards'],
        content:
            '上下文工程应区分系统指令、用户意图、会话记忆、RAG 引用、工具结果和安全约束。上下文拼接需要定义优先级、token 预算、压缩策略、去重策略、引用保真和敏感信息隔离。'
    },
    {
        title: '需求到交付 Agent 产品设计指南',
        tags: ['copilot', 'architecture', 'ai-native', 'standards'],
        scopes: ['architecture', 'ai-native', 'standards'],
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
        scopes: ['architecture', 'standards'],
        content: `B 端 SaaS PRD 应包含：产品定位、目标用户、核心场景、功能模块、权限模型、数据模型、接口协议、非功能需求、验收标准。
                页面结构遵循：列表-详情-设置三段式，支持多角色视图切换。
                API 设计遵循 RESTful 或 RPC 风格，需有版本管理、限流、审计。
                测试策略：单元测试、集成测试、E2E、性能测试、安全测试。
                上线风险：数据迁移、权限割接、灰度发布、回滚预案。`
    },
    {
        title: 'B 端 SaaS 客户管理后台产品设计',
        tags: ['copilot', 'business', 'saas', 'crm'],
        scopes: ['business'],
        content: 'B 端 SaaS 客户管理后台典型页面：1) 客户档案管理 - 客户列表、客户详情、联系人管理、客户标签、操作审计；2) 跟进记录 - 跟进时间线、跟进表单、附件上传、跟进提醒；3) 销售漏斗 - 漏斗看板、阶段拖拽、转化率统计、预期金额；4) 团队协作 - 权限管理、操作日志、消息通知、任务分配。典型 API：GET/POST /api/customers、GET/POST /api/follow-ups、GET /api/sales-pipeline、POST /api/permissions。'
    },
    {
        title: '智能客服知识库产品设计',
        tags: ['copilot', 'business', 'knowledge', 'service'],
        scopes: ['business'],
        content: '智能客服知识库典型页面：1) 问答接待台 - 问题输入、流式答案、引用卡片、低置信度提示、转人工入口；2) 知识库管理 - 文档上传、分组标签、向量索引状态、失效知识提醒、灰度发布；3) 质检反馈台 - 答案采纳、人工纠错、未解决问题池、命中率统计、知识缺口分析；4) 运营看板 - 命中率、未解决率、人工接管率、高频问题、质检通过率。典型 API：POST /api/knowledge/search、POST /api/conversations/:id/messages、POST /api/knowledge/feedback。'
    },
    {
        title: '投研报告生成工作台产品设计',
        tags: ['copilot', 'business', 'research', 'report'],
        scopes: ['business'],
        content: '投研报告生成工作台典型页面：1) 资料导入区 - 研报上传、公司/行业标签、资料解析状态、引用质量检查；2) 报告生成区 - 大纲生成、章节草稿、引用定位、风险提示、模型选择；3) 合规复核区 - 投资建议标记、敏感表述检查、引用缺失检查、人工审批；4) 报告导出区 - Markdown 导出、PDF 导出、审计记录、版本对比。典型 API：POST /api/research/upload、POST /api/research/generate、POST /api/research/compliance-review。'
    }
];

export async function seedKnowledgeIfEmpty (store, { tenantId = DEFAULT_TENANT_ID, actorId = 'system-seed' } = {}) {
    if (!store || typeof store.createDocument !== 'function') {
        console.warn('[seed] store does not support createDocument, skip');
        return { seeded: false, reason: 'store unsupported' };
    }

    try {
        const context = createServiceTenantContext({ tenantId, actorId, allowedKnowledgeScopes: ['*'] });
        const count = typeof store.countChunks === 'function' ? await store.countChunks(context) : 0;

        // 修复历史 chunk：早期数据可能缺失 tenantId/scopes，导致 $vectorSearch filter 无法命中
        if (typeof store.db === 'object' && store.db) {
            const chunks = store.db.collection('chunks');
            const missingTenant = await chunks.countDocuments({
                $or: [
                    { tenantId: { $exists: false } },
                    { tenantId: null },
                    { tenantId: '' },
                    { scopes: { $exists: false } },
                    { scopes: { $size: 0 } }
                ]
            });
            if (missingTenant > 0) {
                const result = await chunks.updateMany(
                    {
                        $or: [
                            { tenantId: { $exists: false } },
                            { tenantId: null },
                            { tenantId: '' }
                        ]
                    },
                    { $set: { tenantId } }
                );
                const resultScopes = await chunks.updateMany(
                    {
                        $or: [
                            { scopes: { $exists: false } },
                            { scopes: { $size: 0 } },
                            { scopes: null }
                        ]
                    },
                    { $set: { scopes: ['legacy'] } }
                );
                console.log(`[seed] repaired ${result.modifiedCount} chunks missing tenantId, ${resultScopes.modifiedCount} chunks missing scopes`);
            }
        }

        if (count > 0) {
            console.log(`[seed] chunks already exist (${count}), skip auto seed`);
            return { seeded: false, reason: 'chunks already exist', count };
        }

        console.log(`[seed] chunks empty, auto seeding ${seedKnowledge.length} documents to tenant ${tenantId}`);
        const created = [];
        for (const item of seedKnowledge) {
            const doc = await store.createDocument(context, {
                title: item.title,
                content: item.content,
                tags: item.tags,
                scopes: item.scopes,
                sourceType: 'template',
                sourcePath: 'system-seed'
            });
            created.push(doc);
        }
        console.log(`[seed] created ${created.length} documents`);
        return { seeded: true, count: created.length, tenantId };
    } catch (error) {
        console.error(`[seed] failed: ${error.message}`);
        return { seeded: false, reason: error.message };
    }
}
