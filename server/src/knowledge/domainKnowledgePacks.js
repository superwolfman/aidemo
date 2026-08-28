const BASELINE = {
    sourceType: 'reviewed-knowledge-pack',
    sourceName: 'aidemo 产品知识基线',
    authorityLevel: 'internal-reviewed',
    reviewStatus: 'approved',
    version: '1.0.0',
    effectiveAt: '2026-08-12T00:00:00.000Z',
    reviewDueAt: '2027-02-12T00:00:00.000Z'
};

const KERING_RETAIL_DEMO_PACK = 'kering-greater-china-retail-demo';
export const KERING_RETAIL_SCOPES = [
    'retail-operations',
    'knowledge-governance',
    'access-control',
    'rag-evaluation',
    'public-strategy'
];
const KERING_RETAIL_DEMO_BASELINE = {
    sourceName: 'aidemo KERING 定向面试知识包',
    reviewStatus: 'approved',
    version: '1.0.0',
    effectiveAt: '2026-08-20T00:00:00.000Z',
    reviewDueAt: '2026-11-20T00:00:00.000Z',
    usageBoundary: 'interview-demo-only'
};

function knowledgeDocument ({ pack, slug, title, tags, scopes, content }) {
    return {
        title,
        tags: ['copilot', pack, ...tags],
        scopes,
        content,
        knowledgeMetadata: {
            ...BASELINE,
            knowledgePack: pack,
            sourceUri: `internal://knowledge-packs/${pack}/${slug}`
        }
    };
}

function keringRetailDemoDocument ({ slug, title, tags, scopes, content, publicSource = false }) {
    return {
        title,
        tags: ['copilot', KERING_RETAIL_DEMO_PACK, 'luxury-retail', ...tags],
        scopes,
        content,
        knowledgeMetadata: {
            ...KERING_RETAIL_DEMO_BASELINE,
            knowledgePack: KERING_RETAIL_DEMO_PACK,
            sourceName: publicSource ? 'KERING 官方网站' : KERING_RETAIL_DEMO_BASELINE.sourceName,
            sourceType: publicSource ? 'official-public' : 'synthetic-demo',
            authorityLevel: publicSource ? 'official' : 'synthetic-reviewed',
            provenanceKind: publicSource ? 'public-official' : 'synthetic-demo',
            isSynthetic: !publicSource,
            sourceUri: publicSource
                ? 'https://www.kering.com/cn/group/discover-kering/our-strategy/'
                : `demo://knowledge-packs/${KERING_RETAIL_DEMO_PACK}/${slug}`,
            publishedAt: publicSource ? '2026-04-16T00:00:00.000Z' : undefined,
            disclaimer: publicSource
                ? '基于 KERING 官网公开信息整理，仅用于面试演示，不代表 KERING 内部政策或未公开事实。'
                : '为面试演示设计的模拟企业规范，不代表 KERING、旗下品牌或任何真实企业的内部政策。'
        }
    };
}

const SGS_FRONTEND_AI_DEMO_PACK = 'sgs-frontend-ai-delivery-demo';
// public-strategy 必须包含：公开资料 doc 只有这一个 scope，缺了会被 Atlas $vectorSearch 硬过滤掉。
export const SGS_FRONTEND_AI_SCOPES = [
    'public-strategy',
    'frontend-component-governance',
    'bff-api-contract',
    'test-quality-gate',
    'human-approval-flow',
    'rag-evaluation'
];
const SGS_FRONTEND_AI_DEMO_BASELINE = {
    sourceName: 'aidemo SGS 定向面试知识包',
    reviewStatus: 'approved',
    version: '1.0.0',
    effectiveAt: '2026-08-28T00:00:00.000Z',
    reviewDueAt: '2026-11-28T00:00:00.000Z',
    usageBoundary: 'interview-demo-only'
};

export const INVESTMENT_RESEARCH_SCOPES = [
    'investment-research',
    'research-workbench',
    'company-filings',
    'industry-research',
    'financial-analysis',
    'research-report-generation',
    'citation-compliance'
];

export const CUSTOMER_SERVICE_SCOPES = [
    'customer-service',
    'customer-service-knowledge',
    'answer-generation',
    'knowledge-correction',
    'conversation-operations',
    'service-quality',
    'citation-compliance'
];

function sgsFrontendAiDemoDocument ({ slug, title, tags, scopes, content, publicSource = false }) {
    return {
        title,
        tags: ['copilot', SGS_FRONTEND_AI_DEMO_PACK, 'sgs-engineering', ...tags],
        scopes,
        content,
        knowledgeMetadata: {
            ...SGS_FRONTEND_AI_DEMO_BASELINE,
            knowledgePack: SGS_FRONTEND_AI_DEMO_PACK,
            sourceName: publicSource ? 'SGS 官方网站/公开数字化资料' : SGS_FRONTEND_AI_DEMO_BASELINE.sourceName,
            sourceType: publicSource ? 'official-public' : 'synthetic-demo',
            authorityLevel: publicSource ? 'official' : 'synthetic-reviewed',
            provenanceKind: publicSource ? 'public-official' : 'synthetic-demo',
            isSynthetic: !publicSource,
            sourceUri: publicSource
                ? 'https://www.sgs.com/en/our-services/digital-services'
                : `demo://knowledge-packs/${SGS_FRONTEND_AI_DEMO_PACK}/${slug}`,
            publishedAt: publicSource ? '2026-06-30T00:00:00.000Z' : undefined,
            disclaimer: publicSource
                ? '基于 SGS 官网公开数字化服务与 AI 治理资料整理，仅用于面试演示，不代表 SGS 内部 SOP、检测方法或合规判定。'
                : '为面试演示设计的模拟工程规范，不代表 SGS 或其合作方的真实内部流程、合规要求、组件库版本或私有包。'
        }
    };
}

const investmentResearchDocuments = [
    knowledgeDocument({
        pack: 'investment-research',
        slug: 'workbench-flow',
        title: '投研报告工作台产品与流程规范',
        tags: ['research', 'report', 'workflow'],
        scopes: ['investment-research', 'research-workbench', 'research-report-generation'],
        content: `投研报告生成工作台用于把资料导入、证据检索、大纲生成、章节草稿、合规复核、人工审批和版本导出连接为可审计流程。资料导入必须记录 sourceId、来源机构、发布日期、抓取或上传时间、适用公司与行业、文档版本和解析状态；原始文件与解析文本分离存储。生成阶段先确定研究问题和报告模板，再按章节检索证据，任何事实性结论必须关联 citationId，不允许模型凭空补齐财务数字。报告状态采用 draft、review_required、approved、superseded，只有 approved 版本允许正式导出。页面至少包含资料区、检索与引用区、大纲和草稿编辑区、合规检查区、版本与审批区。典型接口包括资料上传、知识检索、大纲生成、章节生成、合规复核、提交审批和版本导出；所有写操作携带 tenantId、operatorId、traceId 与幂等键。`
    }),
    knowledgeDocument({
        pack: 'investment-research',
        slug: 'evidence-authority',
        title: '投研证据来源分级与时效规范',
        tags: ['evidence', 'authority', 'freshness'],
        scopes: ['investment-research', 'company-filings', 'citation-compliance'],
        content: `投研知识按权威性分级。A 级包括监管披露、交易所公告、公司法定报告和经审计财务报告；B 级包括公司官网正式材料、权威行业协会与政府统计；C 级包括经审核的券商或研究机构报告；D 级包括新闻、访谈和其他二手资料。关键财务事实优先采用 A 级来源，C/D 级只能作为观点或线索并明确标注。每条知识必须保存 sourceUri、sourceName、authorityLevel、version、publishedAt、effectiveAt、reviewDueAt 和 contentHash。检索结果过期、互相冲突或缺少发布日期时不得静默生成确定性结论，应返回知识缺口并要求人工核验。引用必须能回到原文页码或段落，报告发布前检查引用完整率、来源等级和时效。`
    }),
    knowledgeDocument({
        pack: 'investment-research',
        slug: 'company-industry-analysis',
        title: '公司与行业研究分析框架',
        tags: ['company', 'industry', 'analysis'],
        scopes: ['investment-research', 'industry-research', 'financial-analysis'],
        content: `公司研究按业务模式、收入与成本驱动、竞争壁垒、治理、财务质量、风险与催化剂组织。行业研究按产业链、供需关系、市场空间、竞争格局、监管约束和周期位置组织。分析必须区分事实、计算、假设和观点：事实附引用，计算附公式与口径，假设附敏感性区间，观点说明证据链。跨期比较必须统一会计口径、币种和报告期；同比、环比、复合增长率、毛利率、经营现金流等指标需记录分子分母与数据源。无法统一口径时不得直接排名。结论部分列出支持证据、反证、待验证问题和数据截止日，避免把历史相关性表达为因果关系。`
    }),
    knowledgeDocument({
        pack: 'investment-research',
        slug: 'report-structure',
        title: '投研报告结构与引用生成规范',
        tags: ['report', 'citation', 'generation'],
        scopes: ['investment-research', 'research-report-generation', 'citation-compliance'],
        content: `标准投研报告包含执行摘要、研究范围与数据截止日、公司或行业概览、核心驱动、财务与经营分析、风险与反证、情景假设、待验证问题、引用清单和免责声明。生成大纲前先检索并覆盖各章节证据，不应先生成完整答案再寻找引用。正文引用使用稳定 citationId，展示来源名称、版本、发布日期和定位信息；同一事实被多个来源支持时优先权威且更新的来源。章节若无合格证据应显示“当前知识库无足够依据”，而不是引用弱相关工程文档。摘要中的每项关键判断必须能追溯到正文证据，版本变更时记录新增、删除和替换的引用。`
    }),
    knowledgeDocument({
        pack: 'investment-research',
        slug: 'compliance-review',
        title: '投研内容合规复核与人工审批规范',
        tags: ['compliance', 'review', 'approval'],
        scopes: ['investment-research', 'citation-compliance', 'research-report-generation'],
        content: `投研内容上线前执行事实核验、引用完整性、来源授权、敏感表述、利益冲突和适当性检查。系统必须把模型生成内容标记为草稿，禁止自动发布投资建议或承诺收益。风险较高的结论、缺少 A/B 级证据的财务事实、来源冲突和过期资料进入人工确认。审批记录包含 reviewerId、decision、comment、evidenceSnapshot、modelId、promptHash、createdAt，确认后锁定内容与引用快照；任何修改产生新版本并重新审批。拒绝和修订原因进入审计历史，但不能反向覆盖原始证据。`
    }),
    knowledgeDocument({
        pack: 'investment-research',
        slug: 'quality-evaluation',
        title: '投研 RAG 与报告质量评测规范',
        tags: ['rag', 'evaluation', 'quality'],
        scopes: ['investment-research', 'research-report-generation', 'citation-compliance'],
        content: `投研 RAG 发布前使用经审核的 Golden Dataset 评测。核心指标包括 Recall@5、引用准确率、无答案识别率、过期来源拦截率和报告事实一致性。Recall@5 衡量预期证据是否进入前五候选；引用准确率衡量返回引用是否真正支持问题；无答案识别率衡量知识库不足时是否拒绝猜测。相关度阈值必须按当前 embedding 模型、索引和知识包版本校准，不长期硬编码为单一数值。知识包、embedding 或索引变更后重新评测，报告保存 datasetVersion、model、index、threshold、metrics 和 evaluatedAt；指标退化时阻断生产发布。`
    })
];

const customerServiceDocuments = [
    knowledgeDocument({
        pack: 'customer-service',
        slug: 'product-flow',
        title: '智能客服知识库产品与接待流程规范',
        tags: ['service', 'knowledge', 'workflow'],
        scopes: ['customer-service', 'customer-service-knowledge', 'conversation-operations'],
        content: `智能客服知识库连接文档入库、问题检索、引用回答、低置信度拒答、转人工、反馈纠错和版本发布。接待台展示会话上下文、答案、引用、置信状态和转人工入口；知识管理台展示来源、适用产品、版本、生效时间、审核状态和索引状态；运营台展示命中率、未解决率、转人工率、采纳率和知识缺口。回答只能使用当前租户、渠道、产品和版本范围内已发布的知识，禁止跨租户或使用草稿内容。创建会话、发送消息、提交反馈和发布知识均记录 traceId 与操作者。`
    }),
    knowledgeDocument({
        pack: 'customer-service',
        slug: 'ingestion-governance',
        title: '客服知识入库、版本与发布治理规范',
        tags: ['ingestion', 'version', 'governance'],
        scopes: ['customer-service-knowledge', 'knowledge-correction', 'citation-compliance'],
        content: `客服知识入库支持产品手册、FAQ、SOP、服务政策和故障公告。每条知识必须记录 sourceUri、owner、productId、channel、locale、version、authorityLevel、effectiveAt、expiresAt、reviewDueAt 和 contentHash。解析后先进入 draft，经过业务负责人审核才发布为 active；新版本生效后旧版本变为 superseded，但保留历史引用快照。退款、价格、服务承诺和隐私等高风险政策必须设置失效时间和复审人。索引构建失败时不得把文档标记为可用，删除知识采用软删除并异步清理向量。`
    }),
    knowledgeDocument({
        pack: 'customer-service',
        slug: 'retrieval-answer',
        title: '客服检索、回答与无答案处理规范',
        tags: ['retrieval', 'answer', 'no-answer'],
        scopes: ['customer-service', 'answer-generation', 'citation-compliance'],
        content: `客服检索先应用 tenant、product、channel、locale、有效期和发布状态过滤，再进行向量召回与业务重排。答案必须直接回应用户问题并展示支持它的引用；引用内容不支持结论、来源过期、候选互相冲突或相关度低时返回“当前知识库暂无可靠答案”，收集必要信息并建议转人工。不得用模型常识补写退款金额、服务时限、账号状态或故障结论。多轮会话只携带必要上下文，用户纠正不能直接成为正式知识。高风险动作如退款、改价、封禁和数据导出必须由受控工具与人工授权执行。`
    }),
    knowledgeDocument({
        pack: 'customer-service',
        slug: 'feedback-correction',
        title: '客服答案反馈与知识纠错闭环规范',
        tags: ['feedback', 'correction', 'operations'],
        scopes: ['customer-service', 'knowledge-correction', 'conversation-operations'],
        content: `反馈分为有帮助、无帮助、事实错误、过期、引用不符和未覆盖。反馈记录 conversationId、question、answer、citations、reason、operatorId 与发生时间，进入待处理池；运营人员核对权威来源后创建知识修订，不直接修改已发布版本。修订经过审核、灰度和回归评测后发布，关联原反馈并通知处理结果。高频未解决问题按影响用户数、风险等级和持续时间排序。错误答案进入回归集，避免下一版本重复出现。`
    }),
    knowledgeDocument({
        pack: 'customer-service',
        slug: 'handoff-privacy',
        title: '客服转人工、隐私与安全边界规范',
        tags: ['handoff', 'privacy', 'security'],
        scopes: ['customer-service', 'conversation-operations', 'service-quality'],
        content: `出现低置信度、连续未解决、用户明确要求、身份敏感操作、投诉升级或安全风险时触发转人工。交接包包含问题摘要、已核验身份状态、已尝试步骤、引用和失败原因，不应包含无关个人信息。日志、检索和模型上下文遵循最小化原则，身份证件、支付凭据、密钥和完整联系方式不得进入普通知识库。人工坐席权限按租户和队列隔离，所有敏感查看与工具操作进入审计日志。会话保留期、脱敏和删除按数据分类策略执行。`
    }),
    knowledgeDocument({
        pack: 'customer-service',
        slug: 'quality-evaluation',
        title: '智能客服 RAG 与服务质量评测规范',
        tags: ['rag', 'evaluation', 'quality'],
        scopes: ['customer-service', 'service-quality', 'citation-compliance'],
        content: `智能客服上线评测覆盖常见问法、口语改写、多轮省略、产品版本差异、冲突知识、过期政策和知识库外问题。核心指标为 Recall@5、引用准确率、答案正确率、无答案识别率、转人工准确率和端到端延迟。Golden Dataset 中问题必须由业务人员审核并标记预期文档、允许答案和拒答条件。阈值按知识域和当前 embedding 校准，不能通过降低阈值把不相关内容包装成命中。生产持续抽样质检，知识版本或检索策略变更必须运行回归集并保留评测报告。`
    })
];

const keringGreaterChinaRetailDemoDocuments = [
    keringRetailDemoDocument({
        slug: 'reconkering-public-strategy',
        title: 'KERING ReconKering 公开战略摘要',
        tags: ['kering-public', 'strategy', 'reconkering'],
        scopes: ['public-strategy'],
        publicSource: true,
        content: `本条只摘要 KERING 官网公开战略信息。ReconKering 强调进一步提升旗下品牌吸引力、追求卓越运营，并继续发挥集团平台能力；公开表述同时关注技术变化、客户期望与市场环境变化带来的新要求。对 AI 产品设计的可引用启示是：能力应服务品牌长期价值和运营质量，通过集团级可复用平台提升效率，同时保留各品牌的差异化表达与治理边界。该公开战略不能被推导为任何门店退款时限、VIP 权益、商品护理、库存状态或客户身份规则；遇到这些具体运营问题，系统必须检索经过授权且处于有效期内的业务知识，证据不足时返回 Knowledge Gap 并转人工。引用本条时必须展示 KERING 官网来源和“公开战略摘要”属性，不得包装成内部制度。`
    }),
    keringRetailDemoDocument({
        slug: 'greater-china-store-copilot-boundary',
        title: '高端精品集团中国区门店运营知识 Copilot 产品边界（模拟）',
        tags: ['greater-china', 'store-operations', 'product-boundary'],
        scopes: ['retail-operations'],
        content: `这是面试演示用的模拟产品边界。门店运营知识 Copilot 面向中国区店员、店长、客户服务与知识运营人员，处理已发布 SOP、服务流程、商品护理指引和常见运营问答。系统可以检索证据、生成带 citation 的答复草稿、提示知识版本并发起人工交接；不得自动承诺退款金额或到账时限，不得判断 VIP 等级或客户资格，不得执行库存调拨、价格修改、账号变更和支付相关动作。页面至少展示问题、当前租户与知识范围、答案、来源版本、有效期、Knowledge Gap、Trace 和转人工入口。BFF 必须从认证 principal 获取 tenantId，客户端输入只用于选择已授权范围。所有输出均为辅助信息，高风险结论在人工确认前不得对外发布。`
    }),
    keringRetailDemoDocument({
        slug: 'multi-house-isolation',
        title: '多 House 知识隔离与权限规范（模拟）',
        tags: ['house', 'tenant-isolation', 'authorization'],
        scopes: ['access-control'],
        content: `这是面试演示用的模拟权限规范。集团共享能力与各 House 知识必须分层治理：tenantId 是强制安全边界，House、region、role 和 locale 是租户内的授权与适用范围。正确顺序是认证中间件解析 principal，校验用户与租户及工作空间 membership，再把服务端确认的 tenantId 与允许范围写入检索查询，最后才执行向量召回和重排。禁止先全库召回再在应用层隐藏，也禁止直接信任请求体声明的 tenantId、House 或 role。共享集团规范只有在明确标记为 group-shared 且通过发布审核后才能跨 House 使用；House 专属内容默认不可见。越权请求返回稳定错误码并记录 requestId、actorId、tenantId、requestedScope 和拒绝原因，日志不得记录完整客户隐私数据。`
    }),
    keringRetailDemoDocument({
        slug: 'store-knowledge-lifecycle',
        title: '门店知识版本、有效期与发布规范（模拟）',
        tags: ['knowledge-governance', 'versioning', 'effective-date'],
        scopes: ['knowledge-governance'],
        content: `这是面试演示用的模拟知识治理规范。门店知识从 draft、review_required、approved 到 published 流转，发布记录必须包含 owner、sourceUri、version、locale、适用区域、effectiveAt、expiresAt、reviewDueAt 和 contentHash。新版本发布后旧版本进入 superseded，但引用快照和审批记录必须保留，便于复盘当时答案使用的证据。检索只应使用已发布且在查询时点有效的内容；未到生效时间、已过期、复审逾期或索引构建失败的文档不得作为确定性答案依据。退款、支付、隐私、客户权益等高风险知识需要双人复核和更短复审周期。内容或 metadata 变化后应重建 chunk 与向量，不需要清空整个数据库；若 embedding 失败留下无有效向量的文档，下一次 seed 应自动补建。`
    }),
    keringRetailDemoDocument({
        slug: 'knowledge-gap-handoff',
        title: '门店问答 Knowledge Gap 与转人工规范（模拟）',
        tags: ['knowledge-gap', 'human-handoff', 'safety'],
        scopes: ['retail-operations', 'knowledge-governance'],
        content: `这是面试演示用的模拟拒答与转人工规范。零命中、相关度低于校准阈值、引用不能支持结论、来源互相冲突、知识过期或问题涉及未授权范围时，系统返回 Knowledge Gap，而不是继续调用模型猜测。业务响应可保持 HTTP 200，并返回 status=knowledge_gap、knowledge_gap=true、answer=null、citations=[]、requestId 和稳定原因码；身份或权限错误仍使用 401/403。需要转人工时，交接包只包含必要的问题摘要、已选知识范围、检索结果、缺口原因、requestId 和 Trace 链接，不携带无关个人信息。页面应明确区分“系统失败”和“没有可靠证据”，允许运营人员把高频缺口送入知识补全流程，但用户对话或模型草稿不能自动升级为正式知识。`
    }),
    keringRetailDemoDocument({
        slug: 'retail-rag-release-gate',
        title: '零售 RAG 评测与上线门禁（模拟）',
        tags: ['rag-evaluation', 'release-gate', 'retail'],
        scopes: ['rag-evaluation'],
        content: `这是面试演示用的模拟评测规范。零售 RAG 上线前使用经业务审核的 Golden Dataset，覆盖常见门店问法、中文口语改写、品牌与区域差异、版本和有效期、越权查询、冲突证据、知识库外问题及转人工场景。核心指标至少包括 Recall@5、citation precision、answer faithfulness、Knowledge Gap 识别率、越权召回率、过期知识拦截率和端到端延迟；其中跨租户或未授权 House 召回必须为零。每次知识包、embedding 模型、chunk 策略、检索 pipeline 或 Atlas index 变化都要重跑回归，报告保存 datasetVersion、knowledgePackVersion、model、index、threshold、metrics 和 evaluatedAt。只有来源真实支持 Artifact、后端确认 live vector 且关键指标达到门禁，才允许把 KERING 定向案例作为主演示。`
    })
];

const sgsGreaterChinaFrontendAiDemoDocuments = [
    sgsFrontendAiDemoDocument({
        slug: 'sgs-public-digital-services',
        title: 'SGS 公开数字化服务与 AI 治理摘要',
        tags: ['sgs-public', 'digital', 'ai-governance'],
        scopes: ['public-strategy'],
        publicSource: true,
        content: `本条只摘要 SGS 官网公开数字化服务与 AI 治理信息，仅用于面试演示。

SGS 集团 1878 年成立于法国鲁昂，是全球领先的测试、检验与认证（TIC）机构，拥有超过 100,000 名员工和 2,600 多个分支机构与实验室，服务覆盖农产品、矿产、石油化工、纺织服装鞋类、玩具及婴幼用品、电子电气、建筑、工业、交通、生命科学、环境和电商等多个行业。SGS 在中国的业务主体为通标标准技术服务有限公司。

SGS 公开的数字化战略强调以数字化和 AI 技术提升 TIC 服务的效率、质量与可追溯性，公开的数字化服务方向包括测试数据管理、报告生成自动化、合规审计与跨实验室协同；集团同时公开关注技术演进、客户期望变化与市场环境对检测认证服务提出的新要求。

该公开信息可用于解释 SGS 对 AI 应用与研发效率的总体方向，但不得推导为任何具体的内部 SOP、检测方法、合规判定、客户合同条款或私有技术栈；遇到具体业务问题，系统必须检索经过授权且处于有效期内的知识，证据不足时返回 Confidence Gap 并转人工。引用本条必须展示 SGS 官方公开来源和"公开数字化服务摘要"属性，不得包装成内部制度。`
    }),
    sgsFrontendAiDemoDocument({
        slug: 'frontend-ai-delivery-boundary',
        title: 'SGS 前端研发 AI 交付评审 Copilot 产品边界（模拟）',
        tags: ['product-boundary', 'ai-delivery', 'frontend'],
        scopes: ['sgs-frontend-ai-delivery', 'frontend-component-governance'],
        content: `[synthetic-demo·系统边界] 本条为面试演示设计的模拟产品边界，不代表 SGS 真实内部流程或产品决策。

产品定位与角色：SGS 前端研发 AI 交付评审 Copilot 面向前端工程师、组件 Owner、AI Coding 推广负责人、QA、业务产品方与 IT/Compliance Reviewer；输入需求、目标页面、组件库版本与约束，输出带 citation 的 PRD 摘要、组件选用清单、BFF 接口契约、测试计划与质量门禁、人工审核节点与 Confidence Gap 标记。

系统允许的动作：检索证据并展示引用与 score、生成带 citation 的交付草案、提示知识版本与有效期、发起人工交接。所有输出均为辅助信息，高风险改动在人工确认前不得对外发布。

系统禁止的动作：自动签发组件版本或合并生产代码；自动执行 npm publish、PR merge 或 Breaking Change；绕过 code review、QA、a11y/SEO 检查与合规审批；把 retrieval score 表述为答案置信概率。`
    }),
    sgsFrontendAiDemoDocument({
        slug: 'component-governance',
        title: '前端组件复用、Element Plus 与公司内部私有包治理（模拟）',
        tags: ['component', 'element-plus', 'private-package'],
        scopes: ['frontend-component-governance'],
        content: `[synthetic-demo·组件治理] 本条为面试演示设计的模拟组件治理规范，不代表 SGS 真实私有组件库或 Design System。

组件四层分层：基础层是 Element Plus 表单、表格、布局等共享 UI 资产；业务层是跨应用复用的业务组件（如委托单表单、报告预览卡片、样品条码扫描）；应用层是仅在单个应用内使用的组件；私有层是 npm 私有包，受版本与维护契约约束。

Element Plus 主题定制：通过 SCSS 设计令牌覆盖实现，核心变量包括 --el-color-primary、--el-color-success、--el-border-radius-base、--el-font-size-base；配合 unplugin-vue-components 按需引入控制产物体积；禁止直接修改 node_modules，禁止在业务组件内硬编码覆盖主题变量。

新增组件准入条件：能力相对稳定、至少两个应用真实复用、与具体业务低耦合、输入输出与异常边界清晰、有明确 Owner。跨业务线复用必须经过组件 Owner 评审，所有新增组件登记到组件清单并接入 Design System 索引。`
    }),
    sgsFrontendAiDemoDocument({
        slug: 'bff-api-contract',
        title: 'BFF 接口契约、CLI / MCP / 自定义 Agent 二次开发（模拟）',
        tags: ['bff', 'cli', 'mcp', 'agent'],
        scopes: ['bff-api-contract'],
        content: `[synthetic-demo·BFF 契约] 本条为面试演示设计的模拟接口与 AI 工具链规范，不代表 SGS 真实 BFF 实现或私有工具链。

BFF 职责与契约：BFF 层负责鉴权、限流、审计、幂等与 TraceId 注入；所有写操作必须携带 tenantId、actorId、traceId、idempotencyKey；接口协议必须包含 request、response、错误码与审计字段；Breaking Change 必须经过版本协商与灰度发布。

CLI 工具链：仓库 scripts/ 目录提供 build、seed、migrate、evaluate 四类命令，统一从 config 读取环境变量，禁止散落的硬编码脚本；每个命令支持 --dry-run 预演模式。

MCP 集成与自定义 Agent：接入第三方 AI 工具时遵循 MCP 协议，每个工具声明 name、description、inputSchema、outputSchema 与权限边界；自定义 Agent 在 Skill Runtime 内注册，受 inputSchema、outputSchema、allowedTools 三重约束，禁止未注册工具直接调用。`
    }),
    sgsFrontendAiDemoDocument({
        slug: 'test-quality-gate',
        title: '测试金字塔、a11y/SEO 与质量门禁（模拟）',
        tags: ['test', 'a11y', 'seo', 'quality-gate'],
        scopes: ['test-quality-gate'],
        content: `[synthetic-demo·质量门禁] 本条为面试演示设计的模拟测试规范，不代表 SGS 真实 CI 门禁参数。

覆盖率阈值：unit 覆盖率 ≥ 80%，关键路径 100%；integration 覆盖 BFF、Skill Runtime、Tool Executor、Agent Trace 核心链路；E2E 使用 Playwright 跑核心路径冒烟。

a11y 与 SEO：a11y 按 WCAG 2.1 AA 执行，覆盖键盘可达性、对比度、焦点管理与语义标签；SEO 覆盖页面结构、meta、sitemap 与 robots 配置。

性能与安全预算：FCP < 1.8s、LCP < 2.5s、INP < 200ms（P75 口径）；依赖审计与 XSS / CSRF / SQLi 扫描任一失败即阻断合并。

CI 阻断规则与质量指标：lint + typecheck + unit + integration + 组件库版本审计 + a11y + 性能预算，任一失败阻断合并；AI 生成代码必须经过人工 code review 与自动化测试双重验证，不得直接进入主分支。质量指标包括组件复用采纳率、缺陷逃逸率、返工率与平均定位时间。`
    }),
    sgsFrontendAiDemoDocument({
        slug: 'hitl-approval-flow',
        title: '人工审核闭环与发布治理（模拟）',
        tags: ['hitl', 'approval', 'release'],
        scopes: ['human-approval-flow'],
        content: `[synthetic-demo·人工审核] 本条为面试演示设计的模拟人工审核闭环规范，不代表 SGS 真实审批流程。

人工审核触发条件：组件版本变更、Breaking Change、跨业务线依赖、合规相关改动、权限与隐私变更、AI 自动生成的关键路径代码、生产配置变更、npm publish 与 PR merge。

审批记录字段：reviewerId、decision（approve / reject / request-changes）、comment、evidenceSnapshot（PRD、组件清单、接口契约、测试报告快照）、modelId、promptHash、createdAt。批准后锁定内容与引用快照；任何修改产生新版本并重新审批；拒绝与修订原因进入审计历史，但不反向覆盖原始证据。

Trace 可追溯：requestId 与 traceId 串联 AI 草稿、组件清单、接口契约到人工决策节点，审批全链路在 Agent Trace 中可复盘。`
    }),
    sgsFrontendAiDemoDocument({
        slug: 'frontend-rag-release-gate',
        title: '前端 AI 交付 RAG 评测与上线门禁（模拟）',
        tags: ['rag-evaluation', 'release-gate', 'frontend'],
        scopes: ['rag-evaluation'],
        content: `[synthetic-demo·评测门禁] 本条为面试演示设计的模拟评测规范，不代表 SGS 真实上线门禁。

Golden Dataset：经业务与 QA 审核，覆盖常见需求问法、口语改写、组件版本差异、冲突知识、过期规范、未授权组件、私有包越权与未覆盖场景。

核心指标：Recall@5、citation precision、answer faithfulness、Confidence Gap 识别率、组件选用采纳率、人工审核命中率与端到端延迟。

回归触发条件：知识包、embedding 模型、chunk 策略、检索 pipeline、组件库版本或 Atlas index 任一变化都必须重跑回归；报告保存 datasetVersion、knowledgePackVersion、model、index、threshold、metrics 与 evaluatedAt。

上线条件：引用真实支持 Artifact、关键指标达到门禁、Confidence Gap 路径与人工审核闭环验证通过，三者齐备才允许把 SGS 定向案例作为主演示。`
    })
];

export const domainKnowledgeDocuments = [
    ...investmentResearchDocuments,
    ...customerServiceDocuments,
    ...keringGreaterChinaRetailDemoDocuments,
    ...sgsGreaterChinaFrontendAiDemoDocuments
];
