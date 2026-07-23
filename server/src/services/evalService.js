export function scoreRunQuality({ sources = [], artifacts = [], trace = [], provider = {}, intent = {} }) {
  const prdArtifact = artifacts.find((artifact) => artifact.type === 'prd');
  const apiArtifact = artifacts.find((artifact) => artifact.type === 'api');
  const hasPrd = Boolean(prdArtifact);
  const hasApi = Boolean(apiArtifact);
  const hasFlow = artifacts.some((artifact) => artifact.type === 'flow');
  const hasTask = artifacts.some((artifact) => artifact.type === 'task' || artifact.type === 'test');
  const hasRisk = artifacts.some((artifact) => artifact.type === 'risk');
  const traceReplayable = trace.length >= 6 && trace.every((item) => item.id && item.name && item.status);
  const retrievalBackends = [...new Set(sources.map((source) => String(source.retrievalBackend || 'unknown')))];
  const hasFallbackSource = retrievalBackends.some((backend) => ['local', 'local-hash'].includes(backend) || backend.includes('fallback'));
  const hasRealVector = sources.length > 0 && retrievalBackends.includes('mongodb-atlas-vector-search');
  const providerLive = provider.mode === 'live' && !provider.fallback && !provider.error;
  const providerTransparent = Boolean(provider.provider && provider.mode);
  const prdText = typeof prdArtifact?.content === 'string' ? prdArtifact.content : JSON.stringify(prdArtifact?.content || '');
  const apiText = typeof apiArtifact?.content === 'string' ? apiArtifact.content : JSON.stringify(apiArtifact?.content || '');
  const prdComplete = hasPrd && prdText.length > 300 && prdText.includes('## 产品目标') && prdText.includes('## 核心用户');
  const apiReasonable = hasApi && apiText.includes('request') && (apiText.includes('response') || apiText.includes('responseEvents'));
  const citationScores = sources.map((source) => Number(source.score || 0));
  const avgCitationScore = citationScores.length
    ? Number((citationScores.reduce((sum, value) => sum + value, 0) / citationScores.length).toFixed(4))
    : 0;
  const checks = [
    { key: 'vector', label: '真实向量检索', passed: hasRealVector && !hasFallbackSource, value: hasRealVector ? 'mongodb-atlas-vector-search' : (retrievalBackends[0] || 'none') },
    { key: 'citation', label: '引用来源命中', passed: sources.length > 0 && avgCitationScore > 0, value: `${sources.length} chunks · avg ${avgCitationScore}` },
    { key: 'prd', label: 'PRD 完整度', passed: prdComplete, value: prdComplete ? 'complete' : (hasPrd ? 'needs-review' : 'missing') },
    { key: 'api', label: 'API Contract 合理性', passed: apiReasonable, value: apiReasonable ? 'reasonable' : (hasApi ? 'needs-review' : 'missing') },
    { key: 'flow', label: '页面 / 状态结构', passed: hasFlow, value: hasFlow ? 'ready' : 'missing' },
    { key: 'task', label: '任务拆解', passed: hasTask, value: hasTask ? 'ready' : 'missing' },
    { key: 'risk', label: '风险与人工确认', passed: hasRisk || intent.riskLevel === 'high', value: intent.riskLevel || 'unknown' },
    { key: 'trace', label: 'Trace 可复盘', passed: traceReplayable, value: `${trace.length} steps` },
    { key: 'provider', label: '真实 Provider 调用', passed: providerLive, value: providerTransparent ? `${provider.provider}/${provider.mode}${providerLive ? '' : ' fallback-or-unavailable'}` : 'unknown' }
  ];
  const passed = checks.filter((item) => item.passed).length;
  return {
    score: Math.round((passed / checks.length) * 100),
    passed,
    total: checks.length,
    avgCitationScore,
    retrievalBackends,
    usesFallbackRetrieval: hasFallbackSource,
    usesRealVector: hasRealVector,
    providerLive,
    checks,
    verdict:
      passed === checks.length
        ? 'ready_for_review'
        : passed >= Math.ceil(checks.length * 0.7)
          ? 'needs_minor_review'
          : 'needs_revision'
  };
}

export async function persistEvalResult(store, run) {
  const quality = run.quality || scoreRunQuality(run);
  return store.createRecord('agent_eval_results', {
    runId: run._id,
    evalCaseId: run.evalCaseId || null,
    score: quality.score,
    passed: quality.passed,
    total: quality.total,
    verdict: quality.verdict,
    checks: quality.checks,
    citationHitCount: run.sources?.length || 0,
    artifactCount: run.artifacts?.length || 0,
    traceStepCount: run.trace?.length || 0,
    createdAt: new Date().toISOString()
  });
}

export function buildEvalCases() {
  return [
    {
      id: 'ai-product-workflow',
      title: 'AI 产品工作流',
      prompt: '为企业内部 AI 产品研发团队建设一个需求到交付 Copilot 工作台，要求覆盖 PRD、页面结构、接口协议、研发任务和人工确认。',
      expected: ['引用来源命中', 'PRD 完整度', 'API Contract 合理性', 'Trace 可复盘']
    },
    {
      id: 'customer-knowledge-base',
      title: '智能客服知识库',
      prompt: '建设智能客服知识库助手，支持文档上传、问题检索、答案引用、人工纠错、会话历史和知识命中质量评估。',
      expected: ['知识库范围清楚', '页面结构覆盖会话与引用', 'API 包含检索和反馈', '风险包含幻觉治理']
    },
    {
      id: 'research-report-workbench',
      title: '投研报告生成工作台',
      prompt: '建设投研报告生成工作台，支持上传资料、检索公司和行业知识、生成报告大纲、输出章节草稿、展示引用来源并进入合规复核。',
      expected: ['业务边界明确', '页面结构覆盖资料/生成/审阅', '接口协议有审计字段', 'Trace 支持合规复核']
    }
  ];
}
