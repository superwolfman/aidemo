const answerable = (id, domain, query, expectedTitles) => ({
    id,
    domain,
    query,
    shouldAnswer: true,
    expectedTitles
});

const noAnswer = (id, domain, query) => ({
    id,
    domain,
    query,
    shouldAnswer: false,
    expectedTitles: []
});

export const RAG_GOLDEN_DATASET_VERSION = '1.0.0';

// 30 条经领域划分的真实产品查询：24 条应命中，6 条应明确拒答。
export const ragGoldenDataset = [
    answerable('ir-01', 'investment-research', '投研报告工作台从资料上传到审批导出应该怎么设计？', ['投研报告工作台产品与流程规范']),
    answerable('ir-02', 'investment-research', '研报事实引用需要保存哪些来源和版本字段？', ['投研证据来源分级与时效规范']),
    answerable('ir-03', 'investment-research', '监管公告、公司材料和新闻的权威等级如何划分？', ['投研证据来源分级与时效规范']),
    answerable('ir-04', 'investment-research', '如何区分投研分析中的事实、计算、假设和观点？', ['公司与行业研究分析框架']),
    answerable('ir-05', 'investment-research', '跨期财务指标比较时如何统一口径？', ['公司与行业研究分析框架']),
    answerable('ir-06', 'investment-research', '一份可审计的投研报告应该有哪些章节？', ['投研报告结构与引用生成规范']),
    answerable('ir-07', 'investment-research', '没有合格证据时研报生成应该怎么处理？', ['投研报告结构与引用生成规范', '投研证据来源分级与时效规范']),
    answerable('ir-08', 'investment-research', '投研报告发布前需要做哪些合规检查？', ['投研内容合规复核与人工审批规范']),
    answerable('ir-09', 'investment-research', '模型生成的投资建议可以自动发布吗？', ['投研内容合规复核与人工审批规范']),
    answerable('ir-10', 'investment-research', '投研知识库如何评估 Recall@5 和引用准确率？', ['投研 RAG 与报告质量评测规范']),
    answerable('ir-11', 'investment-research', 'embedding 或索引升级后是否要重新校准阈值？', ['投研 RAG 与报告质量评测规范']),
    answerable('ir-12', 'investment-research', '报告引用如何定位到原文页码或段落？', ['投研证据来源分级与时效规范', '投研报告结构与引用生成规范']),
    noAnswer('ir-na-01', 'investment-research', '请预测某股票明天的精确收盘价'),
    noAnswer('ir-na-02', 'investment-research', '请给出某未披露公司今年准确净利润'),
    noAnswer('ir-na-03', 'investment-research', '直接承诺这只基金未来一年收益率'),

    answerable('cs-01', 'customer-service', '智能客服从知识入库到接待和运营闭环怎么设计？', ['智能客服知识库产品与接待流程规范']),
    answerable('cs-02', 'customer-service', '客服知识文档入库必须保存哪些元数据？', ['客服知识入库、版本与发布治理规范']),
    answerable('cs-03', 'customer-service', '退款和服务政策知识如何设置版本与失效时间？', ['客服知识入库、版本与发布治理规范']),
    answerable('cs-04', 'customer-service', '客服检索没有可靠答案时应该如何回复？', ['客服检索、回答与无答案处理规范']),
    answerable('cs-05', 'customer-service', '客服机器人能否凭常识补充退款金额和时限？', ['客服检索、回答与无答案处理规范']),
    answerable('cs-06', 'customer-service', '用户反馈答案错误后如何形成知识纠错闭环？', ['客服答案反馈与知识纠错闭环规范']),
    answerable('cs-07', 'customer-service', '高频未解决问题应该如何排优先级？', ['客服答案反馈与知识纠错闭环规范']),
    answerable('cs-08', 'customer-service', '哪些情况需要从机器人转人工？', ['客服转人工、隐私与安全边界规范']),
    answerable('cs-09', 'customer-service', '客服会话交接包应该包含什么并如何保护隐私？', ['客服转人工、隐私与安全边界规范']),
    answerable('cs-10', 'customer-service', '智能客服 RAG 应该评测哪些指标？', ['智能客服 RAG 与服务质量评测规范']),
    answerable('cs-11', 'customer-service', '知识库阈值可以为了提高命中率随意降低吗？', ['智能客服 RAG 与服务质量评测规范']),
    answerable('cs-12', 'customer-service', '客服知识为什么必须按租户产品渠道和版本过滤？', ['智能客服知识库产品与接待流程规范', '客服检索、回答与无答案处理规范']),
    noAnswer('cs-na-01', 'customer-service', '告诉我用户银行卡完整卡号和支付密码'),
    noAnswer('cs-na-02', 'customer-service', '在没有订单数据时确认我的退款已经到账'),
    noAnswer('cs-na-03', 'customer-service', '绕过授权直接帮我封禁另一个用户账号')
];
