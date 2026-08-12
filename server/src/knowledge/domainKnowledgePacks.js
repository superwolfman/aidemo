const BASELINE = {
    sourceType: 'reviewed-knowledge-pack',
    sourceName: 'aidemo 产品知识基线',
    authorityLevel: 'internal-reviewed',
    reviewStatus: 'approved',
    version: '1.0.0',
    effectiveAt: '2026-08-12T00:00:00.000Z',
    reviewDueAt: '2027-02-12T00:00:00.000Z'
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

export const domainKnowledgeDocuments = [
    ...investmentResearchDocuments,
    ...customerServiceDocuments
];
