// export function scoreRunQuality ({ sources = [], artifacts = [], trace = [], provider = {}, intent = {}, prompt = '' }) {
//     const prdArtifact = artifacts.find((artifact) => artifact.type === 'prd');
//     const apiArtifact = artifacts.find((artifact) => artifact.type === 'api');
//     const hasPrd = Boolean(prdArtifact);
//     const hasApi = Boolean(apiArtifact);
//     const hasFlow = artifacts.some((artifact) => artifact.type === 'flow');
//     const hasTask = artifacts.some((artifact) => artifact.type === 'task' || artifact.type === 'test');
//     const hasRisk = artifacts.some((artifact) => artifact.type === 'risk');
//     const traceReplayable = trace.length >= 6 && trace.every((item) => item.id && item.name && item.status);
//     const retrievalBackends = [...new Set(sources.map((source) => String(source.retrievalBackend || 'unknown')))];
//     const hasFallbackSource = retrievalBackends.some((backend) => ['local', 'local-hash'].includes(backend) || backend.includes('fallback'));
//     const hasRealVector = sources.length > 0 && retrievalBackends.includes('mongodb-atlas-vector-search');
//     const providerLive = provider.mode === 'live' && !provider.fallback && !provider.error;
//     const providerTransparent = Boolean(provider.provider && provider.mode);
//     const prdText = typeof prdArtifact?.content === 'string' ? prdArtifact.content : JSON.stringify(prdArtifact?.content || '');
//     const apiText = typeof apiArtifact?.content === 'string' ? apiArtifact.content : JSON.stringify(apiArtifact?.content || '');
//     const prdComplete = hasPrd && prdText.length > 300 && prdText.includes('## 产品目标') && prdText.includes('## 核心用户');
//     const apiReasonable = hasApi && apiText.includes('request') && (apiText.includes('response') || apiText.includes('responseEvents'));
//     const citationScores = sources.map((source) => Number(source.score || 0));
//     const avgCitationScore = citationScores.length
//         ? Number((citationScores.reduce((sum, value) => sum + value, 0) / citationScores.length).toFixed(4))
//         : 0;

//     // ============ 新增：需求匹配度检查 ============
//     const promptText = String(prompt || '');
//     // 提取 prompt 中的关键词（中文 2 字以上，英文 3 字母以上）
//     const promptKeywords = promptText
//         .split(/[\s,，。、；;:：！!？?（）()【】\[\]{}""''《》<>\n\r]+/)
//         .map((w) => w.trim())
//         .filter((w) => w.length >= 2 && !/^(一个|建设|要求|输出|支持|和|的|了|在|为|从|到|用|与|或|也|这|那|有|无|可|以|是|被|把|让|给|向|对|按|照|根据|基于|通过|需要|应该|必须|可以|能够|已经|进行|生成|提供|实现|完成|包含|覆盖|包括|确认|评估|策略|风险|结构|协议|任务|测试|上线|交付|产品|页面|接口|研发|团队|内部|企业|工作|流程|系统|平台|能力|功能|模块|用户|目标|约束|条件|需求|方案|清单|发布|回归|质量|门禁|采纳|返工|缺陷|逃逸|指标|人工|确认|审计|追踪|可复盘|可解释|可恢复|上下文|引用|来源|检索|命中|缺失|补充|文档|项目|规范|架构|前端|后端|全栈|工程师|负责人|产品经理|测试|运维|运营|客服|质检|知识库|问答|纠错|反馈|会话|历史|答案|置信度|阈值|转人工|命中|率|统计|分析|看板|运营|投放|素材|创意|活动|会员|增长| Campaign|ROI|GMV|CTR|CVR|CPA|A\/B|SaaS|BFF|RAG|Agent|Copilot|Trace|Artifact|Skill|SSE|MCP|PRD|API|Flow|Task|Risk|Eval|Provider|fallback|streaming|live|mock|dashscope|deepseek|openai|qwen|turbo|plus|mini|gpt|claude|gemini)$/i.test(w));
//     // 所有 Artifact 文本拼在一起
//     const allArtifactText = artifacts
//         .map((a) => typeof a.content === 'string' ? a.content : JSON.stringify(a.content || ''))
//         .join(' ');
//     // 统计关键词命中数
//     const matchedKeywords = promptKeywords.filter((kw) => allArtifactText.toLowerCase().includes(kw.toLowerCase()));
//     const relevanceScore = promptKeywords.length > 0 ? matchedKeywords.length / promptKeywords.length : 0;
//     const relevancePassed = relevanceScore >= 0.3;

//     // ============ 新增：引用一致性检查（防止编造引用编号）============
//     // 提取 Artifact 文本中所有 [数字] 引用
//     const citationPattern = /\[(\d+)\]/g;
//     const citedNumbers = [];
//     let match;
//     while ((match = citationPattern.exec(allArtifactText)) !== null) {
//         citedNumbers.push(parseInt(match[1], 10));
//     }
//     const maxSourceIndex = sources.length;
//     const hasFabricatedCitations = citedNumbers.some((num) => num > maxSourceIndex);
//     const citationConsistencyPassed = !hasFabricatedCitations && (citedNumbers.length === 0 || citedNumbers.length <= maxSourceIndex * 3);

//     const checks = [
//         { key: 'vector', label: '真实向量检索', passed: hasRealVector && !hasFallbackSource, value: hasRealVector ? 'mongodb-atlas-vector-search' : (retrievalBackends[0] || 'none') },
//         { key: 'citation', label: '引用来源命中', passed: sources.length > 0 && avgCitationScore > 0, value: `${sources.length} chunks · avg ${avgCitationScore}` },
//         { key: 'prd', label: 'PRD 完整度', passed: prdComplete, value: prdComplete ? 'complete' : (hasPrd ? 'needs-review' : 'missing') },
//         { key: 'api', label: 'API Contract 合理性', passed: apiReasonable, value: apiReasonable ? 'reasonable' : (hasApi ? 'needs-review' : 'missing') },
//         { key: 'flow', label: '页面 / 状态结构', passed: hasFlow, value: hasFlow ? 'ready' : 'missing' },
//         { key: 'task', label: '任务拆解', passed: hasTask, value: hasTask ? 'ready' : 'missing' },
//         { key: 'risk', label: '风险与人工确认', passed: hasRisk || intent.riskLevel === 'high', value: intent.riskLevel || 'unknown' },
//         { key: 'trace', label: 'Trace 可复盘', passed: traceReplayable, value: `${trace.length} steps` },
//         { key: 'provider', label: '真实 Provider 调用', passed: providerLive, value: providerTransparent ? `${provider.provider}/${provider.mode}${providerLive ? '' : ' fallback-or-unavailable'}` : 'unknown' },
//         // ===== 新增 2 项 =====
//         { key: 'relevance', label: '需求匹配度', passed: relevancePassed, value: relevancePassed ? `${matchedKeywords.length}/${promptKeywords.length} keywords (${(relevanceScore * 100).toFixed(0)}%)` : `${matchedKeywords.length}/${promptKeywords.length} keywords (${(relevanceScore * 100).toFixed(0)}%)` },
//         { key: 'citation_consistency', label: '引用一致性', passed: citationConsistencyPassed, value: hasFabricatedCitations ? `发现编造引用 (sources=${maxSourceIndex}, cited=${Math.max(...citedNumbers)})` : `${citedNumbers.length} citations · max [${maxSourceIndex}]` }
//     ];
//     const passed = checks.filter((item) => item.passed).length;
//     return {
//         score: Math.round((passed / checks.length) * 100),
//         passed,
//         total: checks.length,
//         avgCitationScore,
//         retrievalBackends,
//         usesFallbackRetrieval: hasFallbackSource,
//         usesRealVector: hasRealVector,
//         providerLive,
//         relevanceScore: Number(relevanceScore.toFixed(4)),
//         matchedKeywordCount: matchedKeywords.length,
//         totalKeywordCount: promptKeywords.length,
//         hasFabricatedCitations,
//         checks,
//         verdict:
//             passed === checks.length
//                 ? 'ready_for_review'
//                 : passed >= Math.ceil(checks.length * 0.7)
//                     ? 'needs_minor_review'
//                     : 'needs_revision'
//     };
// }

// ============ 评估维度注册表：每个维度返回 0~1 连续分 ============
// weight 为相对权重，最终在"选中维度集合"内归一化，互不影响。
const METRICS = {
    vector: {
        label: '真实向量检索',
        weight: 1,
        score: (c) => (c.hasRealVector && !c.hasFallbackSource ? 1 : 0)
    },
    citation: {
        label: '引用来源命中',
        weight: 1.5,
        score: (c) => {
            if (!c.sources.length) return 0;
            if (c.avgCitationScore <= 0) return 0.3;
            return Math.min(1, 0.4 + c.sources.length / 10); // 命中越多越高，封顶 1
        }
    },
    prd: {
        label: 'PRD 完整度',
        weight: 1.5,
        score: (c) => {
            if (!c.hasPrd) return 0;
            const required = ['## 产品目标', '## 核心用户'];
            const hit = required.filter((s) => c.prdText.includes(s)).length;
            const lengthScore = Math.min(1, c.prdText.length / 1200); // 300字→0.25，1200字→1
            return Math.min(1, (hit / required.length) * 0.6 + lengthScore * 0.4);
        }
    },
    api: {
        label: 'API Contract 合理性',
        weight: 1,
        score: (c) => {
            if (!c.hasApi) return 0;
            const hasReq = c.apiText.includes('request');
            const hasRes = c.apiText.includes('response') || c.apiText.includes('responseEvents');
            return (hasReq ? 0.5 : 0) + (hasRes ? 0.5 : 0);
        }
    },
    flow: {
        label: '页面 / 状态结构',
        weight: 1,
        score: (c) => (c.hasFlow ? 1 : 0)
    },
    task: {
        label: '任务拆解',
        weight: 1,
        score: (c) => (c.hasTask ? 1 : 0)
    },
    risk: {
        label: '风险与人工确认',
        weight: 1,
        score: (c) => (c.hasRisk || c.intent.riskLevel === 'high' ? 1 : 0)
    },
    trace: {
        label: 'Trace 可复盘',
        weight: 1.5,
        score: (c) => {
            if (!c.trace.length) return 0;
            const complete = c.trace.filter((i) => i.id && i.name && i.status).length / c.trace.length;
            const depth = Math.min(1, c.trace.length / 8); // 6步→0.75，8步→1
            return complete * 0.6 + depth * 0.4;
        }
    },
    provider: {
        label: '真实 Provider 调用',
        weight: 0.5,
        score: (c) => (c.providerLive ? 1 : (c.provider.provider && c.provider.mode ? 0.5 : 0))
    },
    relevance: {
        label: '需求匹配度',
        weight: 1,
        score: (c) => c.relevanceScore
    },
    citation_consistency: {
        label: '引用一致性',
        weight: 0.5,
        score: (c) => (c.citationConsistencyPassed ? 1 : 0)
    }
};

// Eval Case expected 中文标签 → 维度 key（覆盖 buildEvalCases 全部 expected 文案）
const LABEL_TO_KEY = {
    '引用来源命中': 'citation',
    'PRD 完整度': 'prd',
    'API Contract 合理性': 'api',
    'Trace 可复盘': 'trace',
    '需求匹配度': 'relevance',
    '引用一致性': 'citation_consistency',
    '知识库范围清楚': 'citation',
    '页面结构覆盖会话与引用': 'flow',
    'API 包含检索和反馈': 'api',
    '风险包含幻觉治理': 'risk',
    '业务边界明确': 'prd',
    '页面结构覆盖资料/生成/审阅': 'flow',
    '接口协议有审计字段': 'api',
    'Trace 支持合规复核': 'trace'
};

// 从 run 派生所有上下文变量（原逻辑平移，仅拆分复用）
function buildScoreContext ({ sources = [], artifacts = [], trace = [], provider = {}, intent = {}, prompt = '' }) {
    const prdArtifact = artifacts.find((a) => a.type === 'prd');
    const apiArtifact = artifacts.find((a) => a.type === 'api');
    const hasPrd = Boolean(prdArtifact);
    const hasApi = Boolean(apiArtifact);
    const hasFlow = artifacts.some((a) => a.type === 'flow');
    const hasTask = artifacts.some((a) => a.type === 'task' || a.type === 'test');
    const hasRisk = artifacts.some((a) => a.type === 'risk');
    const traceReplayable = trace.length >= 6 && trace.every((i) => i.id && i.name && i.status);
    const retrievalBackends = [...new Set(sources.map((s) => String(s.retrievalBackend || 'unknown')))];
    const hasFallbackSource = retrievalBackends.some((b) => ['local', 'local-hash'].includes(b) || b.includes('fallback'));
    const hasRealVector = sources.length > 0 && retrievalBackends.some((backend) => (
        backend === 'mongodb-atlas-vector-search' || backend === 'mongodb-atlas-hybrid-search'
    ));
    const providerLive = provider.mode === 'live' && !provider.fallback && !provider.error;
    const prdText = typeof prdArtifact?.content === 'string' ? prdArtifact.content : JSON.stringify(prdArtifact?.content || '');
    const apiText = typeof apiArtifact?.content === 'string' ? apiArtifact.content : JSON.stringify(apiArtifact?.content || '');
    const citationScores = sources.map((s) => Number(s.score || 0));
    const avgCitationScore = citationScores.length
        ? Number((citationScores.reduce((s, v) => s + v, 0) / citationScores.length).toFixed(4))
        : 0;

    // 需求匹配度：精简停用词，只过滤真正的虚词，保留 RAG/Agent/PRD/API/产品/用户 等业务词
    const STOPWORDS = new Set([
        '一个', '建设', '要求', '输出', '支持', '和', '的', '了', '在', '为', '从', '到', '用', '与', '或', '也', '这', '那', '有', '无', '可', '以', '是', '被', '把', '让', '给', '向', '对', '按', '照', '根据', '基于', '通过', '需要', '应该', '必须', '可以', '能够', '已经', '进行', '生成', '提供', '实现', '完成', '包含', '覆盖', '包括', '确认', '评估', '策略', '风险', '结构', '协议', '任务', '测试', '上线', '交付', '产品', '页面', '接口', '研发', '团队', '内部', '企业', '工作', '流程', '系统', '平台', '能力', '功能', '模块', '用户', '目标', '约束', '条件', '需求', '方案', '清单', '发布', '回归', '质量', '门禁', '采纳', '返工', '缺陷', '逃逸', '指标', '人工', '确认', '审计', '追踪', '可复盘', '可解释', '可恢复', '上下文', '引用', '来源', '检索', '命中', '缺失', '补充', '文档', '项目', '规范', '架构', '前端', '后端', '全栈', '工程师', '负责人', '产品经理', '测试', '运维', '运营', '客服', '质检', '知识库', '问答', '纠错', '反馈', '会话', '历史', '答案', '置信度', '阈值', '转人工', '命中', '率', '统计', '分析', '看板', '投放', '素材', '创意', '活动', '会员', '增长'
    ]);
    const promptText = String(prompt || '');
    const promptKeywords = promptText
        .split(/[\s,，。、；;:：！!？?（）()【】\[\]{}""''《》<>\n\r]+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
    const allArtifactText = artifacts
        .map((a) => typeof a.content === 'string' ? a.content : JSON.stringify(a.content || ''))
        .join(' ');
    const matchedKeywords = promptKeywords.filter((kw) => allArtifactText.toLowerCase().includes(kw.toLowerCase()));
    const relevanceScore = promptKeywords.length > 0 ? Number((matchedKeywords.length / promptKeywords.length).toFixed(4)) : 0;

    // 引用一致性
    const citationPattern = /\[(\d+)\]/g;
    const citedNumbers = [];
    let m;
    while ((m = citationPattern.exec(allArtifactText)) !== null) citedNumbers.push(parseInt(m[1], 10));
    const maxSourceIndex = sources.length;
    const hasFabricatedCitations = citedNumbers.some((n) => n > maxSourceIndex);
    // 引用堆砌检测：sources 有多条，但正文 3 次以上引用全部指向同一条 → citation 沦为装饰
    const distinctCited = [...new Set(citedNumbers)];
    const hasCitationStacking = maxSourceIndex >= 2 && citedNumbers.length >= 3 && distinctCited.length === 1;
    // source 利用率：正文实际引用了几条不同的 source
    const sourceUtilization = maxSourceIndex > 0 ? Number((distinctCited.length / maxSourceIndex).toFixed(4)) : 0;
    const citationConsistencyPassed = !hasFabricatedCitations && !hasCitationStacking && (citedNumbers.length === 0 || citedNumbers.length <= maxSourceIndex * 3);

    return {
        sources, artifacts, trace, provider, intent, prompt,
        hasPrd, hasApi, hasFlow, hasTask, hasRisk,
        retrievalBackends, hasFallbackSource, hasRealVector, providerLive,
        prdText, apiText, avgCitationScore, traceReplayable,
        relevanceScore, citationConsistencyPassed,
        hasCitationStacking, sourceUtilization, distinctCitedCount: distinctCited.length,
        promptKeywords, matchedKeywords
    };
}

export function scoreRunQuality (run, opts = {}) {
    const c = buildScoreContext(run);
    const expected = opts.expected && opts.expected.length ? opts.expected : null;

    // ① 环境能力单独上报，不计入内容质量分
    const capabilities = {
        realVector: c.hasRealVector,
        realProvider: c.providerLive,
        fallbackRetrieval: c.hasFallbackSource,
        retrievalBackends: c.retrievalBackends
    };

    // ② Case-aware：有 expected 则只评这些维度；否则评全部 11 项
    // const keys = expected
    //     ? expected.map((label) => LABEL_TO_KEY[label]).filter(Boolean)
    //     : Object.keys(METRICS);
    const keys = expected
        ? expected.map((label) => {
            const key = LABEL_TO_KEY[label];
            if (!key) console.warn(`[eval] unknown expected label: ${label}`);
            return key;
        }).filter(Boolean)
        : Object.keys(METRICS);
    const selected = keys.length ? keys : Object.keys(METRICS);

    let totalWeight = 0;
    let weighted = 0;
    const checks = selected.map((key) => {
        const metric = METRICS[key];
        const s = metric ? Number(metric.score(c).toFixed(2)) : 0;
        const w = metric ? metric.weight : 1;
        weighted += s * w;
        totalWeight += w;
        return {
            key,
            label: metric ? metric.label : key,
            passed: s >= 0.6,
            value: s >= 0.6 ? 'pass' : (s >= 0.3 ? 'partial' : 'fail'),
            score: s // 0~1 连续分，前端可展示进度条
        };
    });

    const passed = checks.filter((it) => it.passed).length;
    const score = totalWeight ? Math.round((weighted / totalWeight) * 100) : 0;

    return {
        score,
        passed,
        total: checks.length,
        citationHitCount: c.sources.length,
        avgCitationScore: c.avgCitationScore,
        retrievalBackends: c.retrievalBackends,
        usesFallbackRetrieval: c.hasFallbackSource,
        usesRealVector: c.hasRealVector,
        providerLive: c.providerLive,
        relevanceScore: Number(c.relevanceScore.toFixed(4)),
        matchedKeywordCount: c.matchedKeywords.length,
        totalKeywordCount: c.promptKeywords.length,
        citationConsistencyPassed: c.citationConsistencyPassed,
        hasCitationStacking: c.hasCitationStacking,
        sourceUtilization: c.sourceUtilization,
        distinctCitedCount: c.distinctCitedCount,
        capabilities, // ← 新增：环境能力独立字段
        checks,
        verdict: score >= 90 ? 'ready_for_review' : score >= 70 ? 'needs_minor_review' : 'needs_revision'
    };
}

export async function persistEvalResult (store, run) {
    const quality = run.quality || scoreRunQuality(run);
    return store.createRecord('agent_eval_results', {
        runId: run._id,
        evalCaseId: run.evalCaseId || null,
        score: quality.score,
        passed: quality.passed,
        total: quality.total,
        verdict: quality.verdict,
        checks: quality.checks,
        capabilities: quality.capabilities || null, // ← 新增：环境能力随结果持久化
        citationHitCount: run.sources?.length || 0,
        artifactCount: run.artifacts?.length || 0,
        traceStepCount: run.trace?.length || 0,
        createdAt: new Date().toISOString()
    });
}

export function buildEvalCases () {
    return [
        {
            id: 'ai-product-workflow',
            title: 'AI 产品工作流',
            prompt: '为企业内部 AI 产品研发团队建设一个需求到交付 Copilot 工作台，要求覆盖 PRD、页面结构、接口协议、研发任务和人工确认。',
            expected: ['引用来源命中', 'PRD 完整度', 'API Contract 合理性', 'Trace 可复盘', '需求匹配度', '引用一致性']
        },
        {
            id: 'customer-knowledge-base',
            title: '智能客服知识库',
            prompt: '建设智能客服知识库助手，支持文档上传、问题检索、答案引用、人工纠错、会话历史和知识命中质量评估。',
            expected: ['知识库范围清楚', '页面结构覆盖会话与引用', 'API 包含检索和反馈', '风险包含幻觉治理', '需求匹配度', '引用一致性']
        },
        {
            id: 'research-report-workbench',
            title: '投研报告生成工作台',
            prompt: '建设投研报告生成工作台，支持上传资料、检索公司和行业知识、生成报告大纲、输出章节草稿、展示引用来源并进入合规复核。',
            expected: ['业务边界明确', '页面结构覆盖资料/生成/审阅', '接口协议有审计字段', 'Trace 支持合规复核', '需求匹配度', '引用一致性']
        }
    ];
}
