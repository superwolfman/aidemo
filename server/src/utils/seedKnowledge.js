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
    },
    // ===== 用户领域知识库：前端工程治理、可观测性、性能优化 =====
    {
        title: '应用群工程与交付治理案例',
        tags: ['engineering-governance', 'monorepo', 'frontend', 'architecture'],
        scopes: ['engineering-governance', 'architecture', 'frontend'],
        content: `案例定位：工程、依赖和交付治理项目，不是微前端项目。核心目标是在保留应用边界的前提下，统一 10 个 React/Vue2 应用的工程基线、公共能力、构建发布和线上追踪。

背景矛盾：10 个独立前端应用各自维护 package.json、构建脚本、环境变量、Nginx、Docker、监控埋点、发布回滚。表面问题是构建慢、容器多，深层问题是同一能力重复建设，安全升级、公共能力变更和发布规范无法统一。

职责 Owner：明确目标、治理边界、分阶段计划；设计 Monorepo 仓库与依赖方向；定义公共包准入与版本规则；设计统一构建、产物、缓存、Source Map 方案；设计 Docker/Nginx/灰度/回滚/CDN 链路；协调业务、测试、运维完成迁移。

Monorepo 目录：使用 pnpm workspace，仓库划分为 apps(admin/operation/workspace)、packages(request/auth/logger/i18n/ui/hooks)、tooling(vite-preset/eslint-config/tsconfig/build-scripts/cdn-refresh)。Monorepo 不代表应用强耦合：每个应用保留独立入口与业务边界；公共包不依赖具体业务；业务应用间禁止直接源码依赖；业务状态留在应用内；是否统一发布按交付场景定。

公共包准入：能力相对稳定；至少两个应用真实复用；与具体业务低耦合；输入输出和异常边界清晰；有明确 Owner 和长期维护价值。治理机制：SemVer 和 changelog；peerDependencies 控制框架依赖；beta 版本和灰度验证；单元测试、类型检查和构建验证；Breaking Change 迁移文档；废弃标记和清理周期；避免把公共包变成业务代码垃圾场。

构建优化：统一 Vite 配置包括环境变量白名单和运行前校验；公共别名、CSS、静态资源和浏览器兼容规则；路由和低频组件代码分割；release、commit 和环境信息注入；Source Map 作为私有产物上传；Bundle 分析和体积阈值。典型增量构建 120 秒降到 15 秒（同等级 CI 资源，按 Git diff 识别变更 workspace，沿依赖图算受影响应用，只构建 affected，pnpm store/产物缓存，无依赖任务并行）。

Docker 多阶段构建：Node 阶段安装依赖和构建；Nginx 阶段只复制 dist 和 nginx.conf；不将 node_modules、源码和构建缓存带入运行镜像；增加健康检查和安全配置。镜像 2.8GB 降到约 280MB（原镜像含 Node 运行环境、依赖、源码与多应用构建内容；优化后运行层为 Nginx + 私有化交付场景下多应用静态产物）。

Nginx 职责：静态服务、SPA history fallback、多应用路径分发、gzip/brotli、Cache-Control、安全 Header、健康检查、与灰度切流配合。

缓存策略：带 content hash 的 JS/CSS/图片长期 immutable；HTML / manifest 短缓存或 no-cache；新旧资源并存一段时间避免回滚错配。CDN 差量刷新工具：比前后 manifest、识别增改删、分批调 API、失败重试；HTML 与静态资源不同刷新策略，避免全量刷新引发缓存抖动与回源压力。

发布链路：install → lint/typecheck/test → affected build → Docker build → Source Map 上传 → 部署新版本 → 健康检查 → Playwright 核心路径冒烟 → 灰度切流 → 监控观察 → 全量或回滚。回滚前提：旧镜像/旧资源保留、release+commit 可追踪、接口向前向后兼容、功能开关可关高风险能力；不可逆数据结构变化不能只靠前端回滚。

迁移策略：盘点 → 建 workspace 与公共 preset → 低风险应用 POC → 验证开发/构建/发布/回滚 → 分批迁移 → 新项目强制新基线 → 存量触碰即治理 → CI 门禁防再分裂。

结果：统一 10 个应用的工程和交付基线；典型增量构建 120 秒降到 15 秒；Docker 镜像 2.8GB 降到约 280MB；私有化交付场景中部署单元从 10 个减少到 1 个；年成本从约 3 万元降到约 2500 元；形成公司级前端工程和部署规范。`
    },
    {
        title: '前端可观测性与高可用架构',
        tags: ['frontend-observability', 'high-availability', 'architecture', 'frontend'],
        scopes: ['frontend-observability', 'architecture', 'frontend'],
        content: `定位：不是简单接入错误上报，而是把前端错误、性能、用户行为、发布版本、请求链路、告警和恢复串成完整闭环。

背景问题：用户反馈依赖截图和口述；缺少错误栈和 Source Map；缺少用户操作路径；无法判断影响用户和版本范围；前端请求与后端日志无法关联；发布后缺少质量观察；平均定位时间约 2～4 小时。

职责 Owner：可观测性整体架构与数据模型；Logger SDK 核心采集与上报链路亲自实现；release/session/requestId/traceId 规范；采样/队列/聚合/容错策略；与后端、网关、ELK、发布平台打通；告警口径、接入规范、核心系统推广。

SDK 分层：采集层(JS/Promise/Resource/Component Error、白屏、Web Vitals/Long Task/API Duration、Route/Click/Breadcrumb)；上下文层(application/page/environment、release/commit、user/session、device/browser/network、requestId/traceId)；管道层(normalize/sanitize、fingerprint/sample、priority queue/batch、beacon/fetch、IndexedDB limited queue)；平台层(Source Map、ELK/error platform、dashboard/alert、release/rollback)。核心包 gzip < 5KB 指错误采集+基础上下文+上报能力；看板、Source Map 服务、ELK、可选行为/业务插件不包含在内，通过插件或按需配置启用。

核心实现：window.addEventListener('error') 捕获运行时错误；unhandledrejection 捕获未处理 Promise；capture 阶段监听 script/link/img 资源错误；React Error Boundary 和 Vue errorHandler 捕获组件错误；白屏检测结合根节点、关键区域和错误信号，避免只按 DOM 数量误判。性能采集：FCP/LCP/CLS/INP、Long Task、页面和资源加载耗时、接口耗时和失败率、关键页面业务可用时间。TraceId 注入：前端生成 UUID 写 X-Trace-Id 与 localStorage，请求拦截器透传，串联后端日志。

上报管道：不阻塞主线程，卸载可靠。document.visibilityState === 'hidden' 且支持 sendBeacon 时用 navigator.sendBeacon(endpoint, payload)；否则用 fetch keepalive。失败请求有限写入 IndexedDB，online 事件后指数退避重试（仅限可重试错误）。

数据模型：每条事件包含 eventId、eventType、timestamp；application/page/environment；release/commit；userId/sessionId；device/browser/network；requestId/traceId；fingerprint/priority；payload 和脱敏业务上下文。

隐私原则：不采集密码、Token、身份证、银行卡等敏感数据；URL、请求体和表单字段执行白名单或脱敏；行为记录只保留定位必要信息；错误详情和 Source Map 有访问权限和保留期限。

高并发治理：客户端核心错误全量，普通行为按用户或 session 稳定采样；fingerprint 合并重复错误；内存优先级队列；达到条数、字节或时间阈值批量发送；页面隐藏用 sendBeacon；失败数据有限写入 IndexedDB；设置容量、TTL 和最大重试次数；队列压力过高时优先丢弃低价值行为。服务端：网关限流、消息队列削峰、指纹和时间窗口去重、异步存储和索引、原始数据与聚合指标分层、看板优先消费聚合结果。原则：监控系统不能拖垮业务系统，SDK 任何内部异常都不能向业务主流程传播。

Trace 链路：sessionId 关联一次用户会话；requestId 标识一次前端请求；traceId 关联前端、网关、BFF 和后端服务；前端请求拦截器注入 traceId；后端继续透传并写入日志；用户反馈时根据用户、时间、release 和 traceId 查询完整链路。注意：跨域时服务端允许对应 Header；网关不能覆盖已有 traceId；多服务调用保持父子链路关系；日志字段和采样策略统一。

Source Map：CI 构建时生成；上传内部监控平台；不放入公开静态目录；通过 application+release+filename 精确匹配；新版本发布前确认上传成功；旧版本按线上版本生命周期保留；错误平台反解后展示源码位置。

告警：不只按错误数量，而是结合 release、错误率、影响用户和门店数量、持续时间、核心业务链路、环比和历史基线、是否为新出现错误。分级：P0 核心业务大面积不可用；P1 关键功能明显受损或影响大量用户；P2 局部功能/特定版本/设备异常；P3 低频和非关键错误，进入治理队列。

线上定位闭环 8 步：看 release → 看影响范围 → 看指纹/堆栈/Source Map → 看面包屑 → 用 requestId/traceId 查接口链路 → 对比灰度/配置/权限/CDN → 选回滚/关开关/降级/快修 → 修复后补监控/测试/复盘。

主备双发边界：Promise.race 竞速只适合关键查询、幂等请求、主备语义一致、允许多请求额外成本。绝不双发：支付、库存扣减、订单创建、审批提交等有副作用写操作——必须依赖业务幂等键+服务端状态机+补偿，不能靠 Promise.race 解决。

结果：MTTR 2～4 小时降到分钟级；核心系统覆盖 95%+；支撑全年 12 次重大版本零 P0；建成采集 → 定位 → 告警 → 恢复 → 复盘闭环。`
    },
    {
        title: '性能优化与长时间运行稳定性',
        tags: ['performance', 'stability', 'frontend', 'architecture'],
        scopes: ['performance', 'frontend', 'architecture'],
        content: `定位：做性能优化不会先列优化清单，而是先定义用户指标、建立基线、找到主要瓶颈，再做改造并通过线上数据防止回退。

医生工作台内存泄漏案例：现象为使用时间越长越卡；内存从约 100MB 持续增长到 500MB 以上；GC 频繁；交互帧率下降。排查：固定操作路径并稳定复现；Performance 观察主线程、GC 和帧率；操作前后分别保存 Heap Snapshot；对比对象数量和 Retained Size；发现大量 Detached DOM；通过 Retainers 定位到未清理的 WebSocket 回调；进一步发现 ECharts 实例重复创建但没有 dispose。

根因：组件卸载后 WebSocket 回调仍然引用组件对象；闭包保留旧 DOM 和数据；图表生命周期与 React 组件生命周期不一致；长列表 DOM 数量过大，加重内存压力。

解决：useEffect 返回清理函数；统一 WebSocket 订阅和解除订阅；异步任务支持取消；ECharts 组件卸载时 dispose；长列表使用虚拟滚动；增加长时间运行回归测试。结果：内存稳定在约 120MB；长时间运行不再持续增长；帧率恢复到约 60fps。

首屏 FCP 专项：指标统一为 FCP、LCP、INP、业务首屏可用。定位工具：Performance、React Profiler、Bundle Analyzer、Coverage、RUM(P50/P75/P95)。治理分层：1) 应用边界：首屏只加载当前业务需要模块；2) 资源：路由和低频组件懒加载、依赖去重；3) 网络：preconnect、preload、CDN 和缓存；4) 数据：并行请求、取消重复请求、最小可用数据；5) 渲染：状态边界、细粒度订阅、减少无效渲染；6) 主线程：长任务拆分、Worker、延迟非关键 SDK；7) 防回退：性能预算、CI 产物阈值和线上 release 对比。结果：在统一测试设备、网络和业务数据范围内，核心页面 FCP 从 3～5 秒优化到 0.6～0.8 秒。

流程编辑器布局引擎：Block-based Document Model 定义 Node/Edge/Port 标准 schema；插件体系动态注册节点类型、渲染器、校验器；Selection 管理 + History 栈(undo/redo) + Transaction 批操作；布局引擎将 dagre 计算放进 Web Worker，主线程零阻塞；视口窗口化渲染只对视口内节点实例化，配合 transform 位移做增量更新，不依赖主线程重算整图。服务 4 条业务线，编辑响应 <50ms（原 >500ms），复杂场景流畅，收敛为一个内核+N 个插件平台模式。`
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

        // 收集当前租户已有文档（title -> _id），用于判断是否需要创建/重建
        const titleToId = new Map();
        if (typeof store.db === 'object' && store.db) {
            const existingDocs = await store.db.collection('documents')
                .find({ tenantId }, { projection: { title: 1 } })
                .toArray();
            for (const doc of existingDocs) titleToId.set(doc.title, doc._id);
        }

        // 只创建当前租户缺失或「无有效向量」的 seed 文档。
        // 旧的「仅按 title 去重」会在 embedding 生成失败时留下「有 document 无 chunk」的空壳，
        // 并永久跳过重建，导致该文档永远无法被检索召回（表现为领域知识库看起来没生效）。
        const missing = [];
        for (const item of seedKnowledge) {
            const docId = titleToId.get(item.title);
            if (!docId) {
                missing.push(item);
                continue;
            }
            const validChunkCount = typeof store.db === 'object' && store.db
                ? await store.db.collection('chunks').countDocuments({
                      documentId: docId,
                      embedding: { $exists: true, $type: 'array', $ne: [] }
                  })
                : 1;
            if (validChunkCount === 0) {
                console.log(`[seed] orphan seed document without vectors detected, will rebuild: ${item.title}`);
                await store.db.collection('documents').deleteOne({ _id: docId });
                await store.db.collection('chunks').deleteMany({ documentId: docId });
                missing.push(item);
            }
        }

        if (!missing.length) {
            console.log(`[seed] all ${seedKnowledge.length} seed documents already exist with vectors for tenant ${tenantId}`);
            return { seeded: false, reason: 'all seed documents exist', count };
        }

        console.log(`[seed] seeding ${missing.length}/${seedKnowledge.length} missing documents to tenant ${tenantId}`);
        const created = [];
        for (const item of missing) {
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
