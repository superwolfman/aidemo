import { sleep } from '../utils/sse.js';

function pick(value, fallback) {
  return value && String(value).trim() ? String(value).trim() : fallback;
}

function campaignPlan(input = {}) {
  const objective = pick(input.objective, '提升新用户首单转化');
  const audience = pick(input.audience, '近 30 天注册但未下单用户');
  const channels = pick(input.channels, 'App Push、信息流广告、社群');
  const budget = pick(input.budget, '10 万元');

  return `# 活动方案：${objective}

## 目标与人群
- 目标：${objective}
- 核心人群：${audience}
- 预算：${budget}
- 主渠道：${channels}

## 策略
1. 使用限时权益制造行动理由，首屏突出补贴和稀缺性。
2. 对高意向用户走强 CTA 素材，对低意向用户先内容种草再承接优惠券。
3. 按曝光、点击、领取、核销、GMV、ROI 建立漏斗归因。

## 执行节奏
- D-3：素材 A/B 测试，确认 CTR 高于基线 15% 的版本。
- D-1：圈选目标用户，生成 Push 和券包草稿。
- D Day：分渠道投放，小时级监控 CPA 与 ROI。
- D+1：复盘转化链路，沉淀可复用人群包和素材标签。`;
}

function materials(input = {}) {
  const product = pick(input.product, '会员日爆款权益');
  const audience = pick(input.audience, '价格敏感型新客');
  const channel = pick(input.channel, '信息流广告');

  return `# 投放素材

## ${channel} 主文案
给 ${audience} 的限时福利：${product} 今日加码，领券后下单立减。现在进入会场，热门权益优先锁定。

## 标题备选
1. 新客专享，今天下单更划算
2. 会员日权益加码，限时可领
3. 爆款补贴开启，先领券再下单

## 短视频脚本
- 0-3 秒：展示用户犹豫下单的价格痛点。
- 3-8 秒：权益出现，强调立减和限时。
- 8-15 秒：展示下单路径和真实评价。
- 15-20 秒：CTA：立即领券进入会场。

## A/B 测试
- A 版：价格利益点优先。
- B 版：爆款稀缺感优先。
- C 版：用户口碑背书优先。`;
}

function attribution(input = {}) {
  const campaign = pick(input.campaign, '会员日增长活动');
  const spend = Number(input.spend || 120000);
  const gmv = Number(input.gmv || 438000);
  const orders = Number(input.orders || 6200);
  const clicks = Number(input.clicks || 82000);
  const roi = gmv / Math.max(spend, 1);
  const cvr = orders / Math.max(clicks, 1);

  return `# 归因分析：${campaign}

## 结果摘要
- 花费：${spend.toLocaleString()} 元
- GMV：${gmv.toLocaleString()} 元
- 订单：${orders.toLocaleString()}
- ROI：${roi.toFixed(2)}
- 点击转化率：${(cvr * 100).toFixed(2)}%

## 判断
活动整体 ${roi >= 3 ? '达到增长投放标准' : '需要收缩预算并优化素材'}。当前主要机会在于提升领取到核销的转化，建议拆分新客、沉睡用户和高价值会员分别调券。

## 下一步
1. 保留 ROI 前 30% 的素材和人群组合。
2. 对 CPA 高的渠道降低 20% 预算。
3. 增加 Push 二次触达，但必须经过人工确认后发送。`;
}

function ragAnswer(question, contexts) {
  const contextText = contexts
    .map((item, index) => `资料 ${index + 1}《${item.documentTitle}》：${item.content}`)
    .join('\n');

  return `基于当前知识库，问题「${question}」可以这样处理：

${contextText || '当前没有召回到足够相关的资料。'}

结论：
1. 先明确业务目标、人群、触达渠道和可回滚边界。
2. RAG 负责把业务规范、历史活动和投放标准召回给模型，避免只靠通用知识生成。
3. 涉及广告发布、Push 发送、优惠券生效等动作，需要 Agent 进入人工确认节点。
4. 前端需要展示召回来源、执行步骤、状态变化和最终产物，保证可解释、可追踪、可回滚。`;
}

function harnessPlan(input = {}) {
  const moduleName = pick(input.moduleName, '增长活动工作台');
  const changeType = pick(input.changeType, '新增 Agent 工作流与 SSE 状态面板');
  const risk = pick(input.risk, '接口状态不一致、流式输出中断、人工确认绕过、权限边界缺失');
  const stack = pick(input.stack, 'React + Node BFF + MongoDB + SSE');

  return `# AI Coding / AI Harness 方案：${moduleName}

## 背景
- 技术栈：${stack}
- 变更类型：${changeType}
- 主要风险：${risk}

## 团队提效设计
1. 需求阶段：用 RAG 检索历史 PR、业务规则、埋点规范，生成技术方案草稿。
2. 开发阶段：根据接口 Schema 生成 Mock、组件骨架、状态机用例和边界测试。
3. Review 阶段：Code Review Agent 检查鉴权、异常分支、SSE 断连、幂等和回滚。
4. 发布阶段：生成灰度检查清单、监控指标和回滚预案。

## 单测生成策略
- 前端组件：登录态、空态、加载态、错误态、SSE 增量拼接、按钮禁用态。
- BFF 接口：JWT 缺失、token 过期、非法 Origin、MongoDB 不可用 fallback。
- Agent 状态机：pending -> running -> waiting_approval -> success / rolled_back。
- RAG 检索：空文档、低相关召回、重排排序、上下文长度截断。

## 接口 Mock 方案
\`\`\`json
{
  "GET /api/dashboard": {
    "store": "mongo",
    "metrics": {
      "documents": 12,
      "chunks": 96,
      "tasks": 37,
      "waitingApproval": 4
    }
  },
  "POST /api/agent/run/stream": "text/event-stream: task/tool/approval_required/done"
}
\`\`\`

## PR 检查清单
- 是否所有新增接口都经过 JWT 鉴权。
- SSE 是否包含 done 事件，前端是否处理异常断流。
- 高风险工具调用是否进入人工确认。
- MongoDB 写入是否有最小字段校验和索引规划。
- UI 是否覆盖桌面和移动端布局。
- 是否补充 README、启动脚本和演示路径。

## 可量化收益
- 组件与接口 Mock 准备时间降低 40%。
- Review 基础问题前置发现，减少重复沟通。
- 新成员通过 Harness 产物理解业务链路和工程规范。`;
}

function architecturePlan(input = {}) {
  const scenario = pick(input.scenario, '金融级 AI Native 中后台平台');
  const constraints = pick(input.constraints, '多业务线、多技术栈、需要独立发布、需要高可用和全链路可观测');
  const goals = pick(input.goals, '降低成本、提升研发效率、缩短问题定位时间、沉淀平台能力');

  return `# 架构 Copilot 方案：${scenario}

## 业务目标
- ${goals}

## 约束条件
- ${constraints}

## 推荐架构
1. 运行时集成：采用 Shell + 子应用模式，增长运营、RAG、AgentOps、可观测性、研发效能作为可独立演进模块。
2. 工程治理：使用 Monorepo 管理 apps / packages / tooling，沉淀 request、auth、logger、sse-client、agent-state-machine、ui、i18n-sdk。
3. AI 中台能力：统一 LLM Provider、RAG Pipeline、Tool Registry、Prompt Template、Approval Policy、Audit Log。
4. 可观测性：前端 Logger SDK 自动采集错误、Web Vitals、用户行为、SSE 断流、Agent step trace。
5. 高可用：BFF 支持 MongoDB fallback、关键 API 超时控制、Agent 幂等、防重复执行、审批前置。
6. 性能：首屏只加载 Shell 与核心面板，RAG/画布/图表/低频工具动态加载，长列表虚拟滚动，复杂布局交给 Web Worker。
7. 跨端：Web 先沉淀协议，H5 进入 App WebView，Native 能力通过 JSBridge 注入，React Native 复用 Agent 工具协议。

## 架构拆分
\`\`\`text
apps/
  shell-console          # 统一入口、菜单、登录态、权限
  growth-agent           # 增长运营 Agent
  rag-knowledge          # 知识库与检索评估
  observability-console  # Logger、Trace、RUM
  ai-harness             # 单测、Mock、Review、发布清单
packages/
  ui                     # 组件库
  auth                   # 鉴权 SDK
  request                # 请求 SDK
  logger                 # 可观测 SDK
  sse-client             # 流式通信客户端
  agent-state-machine    # Agent 状态机
  i18n-sdk               # 国际化底座
  workflow-core          # 低代码流程文档模型
tooling/
  build-preset
  source-map-upload
  cdn-refresh
  mock-generator
\`\`\`

## AI 最大化利用点
- 需求阶段：RAG 检索业务规则、历史 PR、事故复盘，生成技术方案。
- 开发阶段：根据 Schema 生成组件、Mock、测试和埋点。
- 运行阶段：Agent 自动执行低风险运营任务，高风险动作进入人工确认。
- 质量阶段：Code Review Agent 检查鉴权、幂等、回滚、SSE 断流和性能风险。
- 运维阶段：Observability Agent 根据 traceId、release、错误栈和用户路径生成根因分析。

## 量化指标
- FCP 目标：0.8s 内。
- Agent 步骤可追踪率：100%。
- 高风险动作人工确认覆盖率：100%。
- RAG 回答来源可解释率：100%。
- MTTR 目标：分钟级。
- 新市场 / 新模块接入周期：缩短 50% 以上。`;
}

function specCodingPlan(input = {}) {
  const requirement = pick(input.requirement, '企微内嵌智能问答助手');
  const terminal = pick(input.terminal, 'PC / H5 / 企业微信内嵌应用');
  const risk = pick(input.risk, '多端登录、会话上下文、知识库幻觉、灰度回滚');

  return `# Spec Coding 落地规范：${requirement}

## 1. 需求规格
- 目标终端：${terminal}
- 核心风险：${risk}
- 业务目标：员工在企微、H5、PC 内获得一致的展业知识问答、客户拜访辅助和资料生成能力。

## 2. 数据模型
\`\`\`ts
type EmployeeIdentity = {
  employeeId: string;
  unionId?: string;
  wecomUserId?: string;
  roles: string[];
  terminal: 'pc' | 'h5' | 'wecom';
}

type AssistantSession = {
  sessionId: string;
  employeeId: string;
  channel: 'pc' | 'h5' | 'wecom';
  memory: Message[];
  citations: Citation[];
}
\`\`\`

## 3. API Spec
- POST /api/auth/login：PC 登录。
- POST /api/wecom/oauth：企微 code 换员工身份。
- POST /api/assistant/sessions：创建会话。
- POST /api/assistant/sessions/:id/stream：SSE 流式问答。
- GET /api/rag/documents：知识库文档列表。
- POST /api/skills/:id/run：执行 AI Skill。

## 4. 前端状态机
- idle：未提问。
- retrieving：知识库召回。
- streaming：SSE 输出中。
- need_human：低置信度或敏感问题转人工。
- done：回答完成。
- failed：断流或接口异常，可重试。

## 5. 防幻觉策略
- 回答必须绑定引用来源。
- 无召回或低相关时拒答，不编造。
- 敏感业务问题转人工。
- 会话记忆只保留最近窗口，长期事实走知识库。

## 6. 灰度上线
- 先开放内部白名单。
- 记录 traceId、employeeId、terminal、question、citations、confidence。
- 监控拒答率、转人工率、SSE 失败率和平均响应耗时。
- 支持按终端、部门、员工灰度开关。`;
}

function skillRunResult(skill, input = {}) {
  const text = pick(input.text || input.question || input.customer, '客户准备了解企业数字化展业方案');
  if (skill.id === 'wecom-answer') {
    return `# ${skill.name} 执行结果

## 输入
${text}

## 判断
- 问题需要先走 RAG 召回，再做 citation.guard。
- 如果没有引用来源，返回“暂未检索到可靠依据，建议转人工”。
- 如果涉及收益承诺、客户隐私、监管口径，强制转人工。

## 企微侧输出
建议在企微侧展示 3 段内容：直接结论、引用来源、下一步动作。回答不超过 300 字，避免长篇影响移动端阅读。`;
  }

  if (skill.id === 'label-precheck') {
    return `# ${skill.name} 执行结果

## 输入
${text}

## 预标注结论
- 模型完成初筛，发现 3 个低置信度区域。
- 轨迹点 42-49 疑似漂移，需要人工复核。
- 供应商 B 当前质量分低于阈值，建议提高抽检比例。

## 工作流动作
1. 将低置信度区域标记为 need_review。
2. 自动分配给审核组。
3. 质检通过后进入归档，否则回退供应商重标。`;
  }

  return `# ${skill.name} 执行结果

## 输入
${text}

## 工具编排
${skill.tools.map((tool, index) => `${index + 1}. ${tool}`).join('\n')}

## 输出
- 推荐话术：先确认客户当前展业流程和数据沉淀方式，再介绍知识库问答、资料生成和企微触达闭环。
- 风险提示：涉及收益承诺、敏感合规和无知识库来源的问题必须转人工确认。
- 引用策略：回答需展示知识库来源、更新时间和置信度。
- 下一步：生成拜访摘要、跟进任务和企微素材草稿。`;
}

function questionInsight(question, contexts = []) {
  const text = String(question || '').toLowerCase();
  const rules = [
    { intent: 'wecom_auth', confidence: 0.92, keywords: ['企微', '授权', 'oauth', '登录', 'code', 'userId', 'userid'] },
    { intent: 'anti_hallucination', confidence: 0.9, keywords: ['幻觉', '编造', '引用', '置信', '来源', '拒答'] },
    { intent: 'compliance', confidence: 0.88, keywords: ['合规', '收益', '承诺', '隐私', '监管', '敏感'] },
    { intent: 'annotation', confidence: 0.78, keywords: ['标注', '轨迹', '供应商', '质检', '预标注'] },
    { intent: 'session_memory', confidence: 0.76, keywords: ['上下文', '历史', '会话', '记忆'] },
    { intent: 'material', confidence: 0.82, keywords: ['资料', '素材', '海报', '转发', '群发'] },
    { intent: 'sales_script', confidence: 0.86, keywords: ['话术', '客户', '拜访', '展业', '适用场景', '怎么回答'] }
  ];
  const matched = rules.find((rule) => rule.keywords.some((keyword) => text.includes(keyword.toLowerCase())));
  const topScore = contexts[0]?.score || 0;
  return matched || {
    intent: topScore > 0.18 ? 'knowledge_answer' : 'low_confidence',
    confidence: topScore > 0.18 ? 0.72 : 0.42,
    keywords: []
  };
}

function prioritizeContexts(question, contexts = []) {
  const insight = questionInsight(question, contexts);
  const intentTerms = {
    wecom_auth: ['企微', '授权', '登录', 'oauth', 'code', 'userId', 'employeeId'],
    anti_hallucination: ['幻觉', '引用', '置信', '拒答', '知识库'],
    sales_script: ['话术', '拜访', '展业', '客户', '资料包'],
    material: ['资料', '素材', '转发', '群发'],
    compliance: ['合规', '收益', '承诺', '隐私', '监管', '敏感'],
    annotation: ['标注', '轨迹', '供应商', '质检', 'OpenLayers', 'Leaflet'],
    session_memory: ['会话', '上下文', '记忆', '历史']
  };
  const terms = intentTerms[insight.intent] || [];
  return contexts
    .map((context) => {
      const haystack = `${context.documentTitle || ''} ${context.content || ''}`;
      const intentBoost = terms.some((term) => haystack.includes(term)) ? 0.35 : 0;
      const stalePenalty = ['小红书', '会员增长', '运营 Agent'].some((term) => haystack.includes(term)) ? -0.12 : 0;
      return {
        ...context,
        score: Number(((context.score || 0) + intentBoost + stalePenalty).toFixed(4))
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function enablementAssistantAnswer(question, contexts, memory = []) {
  const insight = questionInsight(question, contexts);
  const cited = contexts
    .filter((item) => item.score >= 0.1)
    .map((item, index) => `引用 ${index + 1}《${item.documentTitle}》score=${item.score}：${item.content}`)
    .join('\n');
  const memorySummary = memory.length ? `已参考最近 ${memory.length} 条会话上下文。` : '当前是新会话。';
  const hasReliableSource = contexts.some((item) => item.score >= 0.08);

  if (insight.intent === 'low_confidence' || !hasReliableSource) {
    return `我没有在当前展业知识库中检索到足够可靠的依据，不能直接给出确定答案。

问题：「${question}」

处理建议：
1. 请补充客户行业、产品名称、展业场景或内部制度名称。
2. 如果是客户正在等待回复，建议先转人工或使用标准兜底话术。
3. 后续应把该问题沉淀到知识库，并补充适用范围、更新时间和负责人。

防幻觉策略：
- 无引用不回答。
- 低置信度不编造。
- 涉及合规、收益承诺、客户隐私的问题必须转人工。`;
  }

  if (insight.intent === 'wecom_auth') {
    return `企微授权和多端登录建议按以下链路处理：

${memorySummary}

${cited}

方案：
1. 企微端通过 JS-SDK 获取 OAuth code，后端用 code 换取 wecomUserId。
2. 将 wecomUserId、手机号或 unionId 归一到企业 employeeId。
3. BFF 签发平台 JWT，前端统一带 Authorization 访问业务接口。
4. PC、H5、企微三端只区分 terminal/channel，不拆散员工身份。
5. code 必须一次性消费，JS-SDK config 签名需要缓存并设置过期刷新。

线上排查：
- 401：检查 JWT 是否过期或 employeeId 归一失败。
- 403：检查企微 scope、应用可见范围、外部联系人权限。
- 签名失败：检查当前 URL、corpId、agentId、ticket 缓存。`;
  }

  if (insight.intent === 'anti_hallucination') {
    return `企微智能问答防幻觉要从“检索、生成、展示、审计”四层控制：

${cited}

落地规则：
1. RAG 召回结果低于阈值时拒答或追问，不允许模型自由发挥。
2. 回答必须展示引用来源、更新时间和置信度。
3. 涉及收益承诺、合规边界、客户隐私的问题进入人工确认。
4. 会话记忆只用于理解上下文，不能替代知识库事实。
5. 每次回答记录 question、citations、confidence、employeeId、terminal、traceId。

前端表现：
- 企微端给短答案 + 引用入口。
- PC 端展示完整引用和历史上下文。
- 低置信度时展示“转人工”按钮。`;
  }

  if (insight.intent === 'sales_script') {
    return `可以给员工生成一段可直接在企微使用的展业话术：

${cited}

建议话术：
您好，我们这套方案主要适合“需要统一员工展业、知识库问答和客户跟进流程”的团队。员工可以在 PC、H5 或企业微信里查询统一知识库，系统会根据客户问题给出带来源的回答，并自动生成拜访摘要和下一步跟进任务。

使用边界：
- 如果客户问到价格、收益、合规承诺，需要转人工或引用正式制度。
- 如果知识库没有召回来源，不建议直接答复。

下一步动作：
1. 生成客户拜访简报。
2. 推荐资料包。
3. 在企微创建跟进任务。`;
  }

  if (insight.intent === 'compliance') {
    return `该问题命中合规/敏感风险，建议进入人工确认。

${cited}

处理策略：
1. 不做收益承诺，不使用绝对化表达。
2. 不输出客户隐私、内部敏感规则或未授权数据。
3. 仅引用已发布、有效期内、权限允许的知识库内容。
4. 前端需要记录员工、终端、客户上下文、引用来源和 traceId。

企微回复建议：
这个问题涉及合规边界，我先帮您转给专业同事确认，避免给出不准确的信息。`;
  }

  if (insight.intent === 'annotation') {
    return `这是 AI 辅助标注/质检类问题，可以按人机协同流程处理：

${cited}

建议流程：
1. 模型先输出预标注结果和置信度。
2. 低置信度区域进入人工复核。
3. 供应商质量低于阈值时提高抽检比例。
4. 轨迹漂移、遮挡、边界不清等问题进入专项质检队列。
5. 质检结果回流训练集和供应商评分。

前端实现：
- 标注任务列表虚拟滚动。
- 轨迹回放用 OpenLayers / Leaflet。
- 质量统计用 ECharts。
- 大规模轨迹计算放到 Web Worker。`;
  }

  return `针对员工展业问题「${question}」：

${memorySummary}

${cited || '当前知识库没有召回到可靠来源，因此不能编造确定答案。'}

建议回答：
1. 先基于知识库来源给出可追溯结论。
2. 如果问题涉及合规、收益承诺、客户隐私或系统权限，进入转人工。
3. 对员工展业场景，输出下一步动作：生成客户拜访简报、推荐资料包、创建跟进任务。
4. 企微端回答要控制篇幅，PC 端可以展示完整引用与历史会话。

防幻觉处理：
- 有来源才回答。
- 低置信度先澄清。
- 敏感问题转人工。
- 会话记忆只辅助理解，不替代知识库事实。`;
}

export const aiService = {
  campaignPlan,
  materials,
  attribution,
  ragAnswer,
  harnessPlan,
  architecturePlan,
  specCodingPlan,
  skillRunResult,
  questionInsight,
  prioritizeContexts,
  enablementAssistantAnswer,

  async streamMarkdown(res, text, sendEvent, delay = 22) {
    const chunks = text.match(/.{1,42}(\s|$)|.+$/gs) || [text];
    for (const chunk of chunks) {
      sendEvent(res, 'delta', { text: chunk });
      await sleep(delay);
    }
  }
};
