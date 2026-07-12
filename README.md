# AI Architecture Copilot

`mcp-poc` 分支基于 `mvp` 分支继续演进，目标是回答面试官深入追问时最容易暴露的 5 个问题：真实 LLM Provider、MCP Server、RAG 后端替换边界、后端旧路由纯净度、专业 UI 细节。

它仍然不是生产级 AI 平台，而是一个更完整的 AI 应用工程 POC：能本地离线演示，也能通过环境变量切到真实模型和 MCP 工具接入路径。

## 快速启动

```bash
npm install
npm run mongo
npm run dev
```

访问：

- 前端：http://127.0.0.1:5173
- 后端：http://127.0.0.1:4000
- 健康检查：http://127.0.0.1:4000/health

登录账号：

```text
removed-default-admin@example.invalid
removed-public-password
```

## mcp-poc 增强点

### 1. 真实 LLM Provider Adapter

默认仍然使用 `mock`，保证本地无 API Key 也能稳定演示。有 Key 时可切换到真实 OpenAI-compatible Provider：

```bash
LLM_PROVIDER=openai
LLM_API_KEY=sk-xxx
LLM_MODEL=gpt-4.1-mini
```

也可以接 DeepSeek、通义千问兼容模式或任意 OpenAI-compatible 服务：

```bash
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://your-provider.example.com/v1
LLM_API_KEY=xxx
LLM_MODEL=your-model
```

运行时接口：

```text
GET /api/copilot/runtime
```

页面左侧 Runtime Board 会显示：

- LLM 当前是 `live` 还是 `fallback`。
- 当前模型名。
- RAG 后端。
- MCP transport 和启动命令。

### 2. MCP Server POC

本分支新增一个最小可运行 MCP Server：

```bash
node server/src/mcp/architectureMcpServer.js
```

实现位置：

```text
server/src/mcp/architectureMcpServer.js
```

它暴露：

resources:

- `architecture://documents`
- `project://rules`

tools:

- `search_architecture_docs`
- `inspect_project_structure`
- `generate_project_rule`

prompts:

- `architecture_review`
- `migration_plan`

说明：

- 当前实现不依赖 SDK，使用 stdio JSON-RPC 和 `Content-Length` framing。
- MCP Host 应使用 `node server/src/mcp/architectureMcpServer.js` 作为 command，避免 `npm run` banner 污染 stdio。
- 这是 POC，用于证明工具、资源、Prompt 可以标准化暴露给外部 AI Host。
- 后续可替换为官方 MCP SDK，并增加鉴权、审计和工具权限策略。

### 3. RAG 后端抽象

当前本地默认：

```bash
RAG_BACKEND=local-hash
```

特点：

- 离线可跑。
- 支持文档切分、本地 hash embedding、向量相似度和关键词融合。
- 适合 MVP 演示链路，不宣传为生产检索质量。

可替换目标：

- `mongodb-atlas`
- `pgvector`
- `milvus`

抽象入口：

```text
server/src/services/ragEngine.js
```

### 4. 后端 API 纯净度

`mcp-poc` 分支已移除旧增长平台残留挂载：

- `/api/dashboard`
- `/api/agent`
- `/api/enablement`
- `/api/rag`
- `/api/ai`
- `/api/harness`
- `/api/observability`
- `/ws`

当前后端只保留：

- `/api/auth`
- `/api/copilot`
- `/health`
- `/`

根接口名称也已改为：

```text
AI Architecture Copilot API
```

### 5. UI 专业度增强

本分支补强：

- Runtime Board：展示 LLM / RAG / MCP 运行时状态。
- Skill Schema 面板：可展开查看 inputSchema、outputSchema、allowedTools、knowledgeScopes。
- 生成中 skeleton：提升流式生成等待体验。
- Trace Timeline：用状态条表达执行路径。
- 引用来源详情：可展开查看来源和 score。
- 审批历史：确认、修改、拒绝会保留最近记录。

## 产品收敛原则

MVP 只保留一个侧边栏入口：`AI Copilot`。

原因：

- 之前多个模块入口展示的是相同 Copilot 能力，会削弱产品边界。
- MVP 的核心不是“模块数量”，而是完整跑通 Agent 工程闭环。
- Skill、RAG、Trace、人工确认、接入文档不再作为重复页面存在，而是沉淀在 Copilot Workbench 内部。

当前工作台分为三列：

- 左侧：会话历史、Skill 系统、RAG 默认模板和上传入口。
- 中间：任务模式、结构化输入、最终请求预览、流式生成结果。
- 右侧：Agent Trace 路径还原、执行步骤详情、人工确认节点。

## MVP 必备功能

### 1. 多会话 AI Chat

已实现：

- 多会话创建和历史切换。
- SSE 流式输出。
- Markdown 渲染。
- 代码块高亮。
- 会话历史持久化到 MongoDB/FileStore。
- 停止生成：前端 `AbortController` 中断流式请求。
- 重新生成：复用最近一条用户消息重新发起生成。

入口文件：

- `client/src/modules/copilot/CopilotWorkbench.tsx`
- `server/src/routes/copilot.js`

### 2. 细化生成工作台

MVP 不再只提供一个大输入框，而是内置 4 个任务模式：

- 需求分析：输出业务目标拆解、非功能约束、验收标准、待确认问题。
- 架构评审：输出架构决策、模块边界、风险清单、演进路线。
- 代码审查：输出风险发现、修复建议、测试缺口、合并建议。
- 架构文档：输出 Markdown 草稿、引用来源、上线计划、人工确认。

每个任务模式都会绑定：

- 默认生成目标。
- 结构化字段。
- 对应 Skill。
- 可用工具。
- 最终请求预览。

这能体现 MVP 是“受约束的技能运行时”，不是单纯 Prompt 页面。

### 3. Skill 系统

内置 3 个 Skill：

- 需求分析 Skill：拆解目标、约束、验收标准和风险。
- 架构评审 Skill：审查前端架构、BFF、RAG、Agent、可观测性和发布风险。
- 代码审查 Skill：关注 PR 风险、测试缺口、性能和工程规范。

每个 Skill 都符合以下结构：

```ts
type SkillDefinition = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
  allowedTools: string[];
  knowledgeScopes: string[];
  version: string;
};
```

设计重点：

- 输入约束：用 `inputSchema` 描述必填字段和类型。
- 输出约束：用 `outputSchema` 约束结构化结果。
- 可用工具：每个 Skill 只能调用 `allowedTools` 中的工具。
- 知识范围：RAG 检索按 `knowledgeScopes` 选择上下文。
- 版本管理：Skill 带 `version`，便于灰度、回滚和审计。

### 4. Tool Calling

MVP 内置 3 个普通函数工具，接口设计保持可迁移到 MCP Server：

- `searchKnowledge`：按 Skill 的 `knowledgeScopes` 检索研发知识库。
- `analyzeRepository`：分析当前工程栈、模块、关注点和风险。
- `generateArchitectureDocument`：生成 Markdown 架构文档草稿。

工具调用不是固定假流程。后端会根据 `allowedTools` 动态决定是否执行：

- 需求分析 Skill：只调用 `searchKnowledge`。
- 架构评审 Skill：调用 `searchKnowledge`、`analyzeRepository`、`generateArchitectureDocument`。
- 代码审查 Skill：调用 `searchKnowledge`、`analyzeRepository`。

工具调用结果会进入 Agent Trace，包括 Tool 名称、输入参数、输出摘要、耗时、token 使用量和错误信息。

### 5. 轻量 RAG 知识库

已实现：

- 上传 Markdown、TXT、PDF。
- 文档切分。
- 本地 embedding。
- 向量检索。
- 回答展示引用来源。
- 根据 Skill 限定知识范围。
- 默认知识模板可选择导入。

MVP 种子知识包括：

- 微前端架构设计文档。
- SDK 规范与工程约束。
- IM 架构文档。
- 低代码组件协议。
- 项目开发规范。

说明：

- Markdown/TXT 直接读取文本。
- PDF 在 MVP 中支持上传和元数据入库；生产环境可接 PDF parser 抽取正文。
- 当前向量检索使用本地 hash embedding，后续可替换为 Milvus、pgvector 或 Pinecone。
- 这个 RAG 不是通用问答，而是按 Skill 动态选择知识域的研发架构知识库。

### 6. 人工确认节点

AI 生成架构建议后会进入暂停状态：

- 用户确认。
- 用户修改。
- 用户拒绝。
- 修改后继续生成最终文档。

接口：

```text
POST /api/copilot/approvals/:id/confirm
POST /api/copilot/approvals/:id/revise
POST /api/copilot/approvals/:id/reject
```

约束：

- 写文件、改配置、发请求等高风险动作不能自动执行。
- 高风险工具必须进入人工确认。
- 审批结果必须保存，便于 Trace 和审计。

### 7. Agent Trace 面板

右侧 Trace 面板展示完整执行轨迹：

```text
用户请求
→ 选择 Skill
→ 加载上下文
→ 调用知识库
→ 按 allowedTools 调用工具
→ 生成结构化结果
→ 等待人工确认
→ 输出最终文档
```

每一步展示：

- 状态：running / success / waiting / failed。
- 耗时。
- Tool 输入输出。
- token 使用量。
- 错误信息。
- 是否需要人工确认。

新增路径还原机制：

- `路径还原`：从最近一次 assistant 消息中恢复 Trace。
- `下一步`：按步骤重放执行轨迹。
- 用于面试演示“Agent 不是黑盒，而是可审计、可复盘的执行系统”。

## SSE 与 WS 取舍

MVP 的核心生成链路采用 SSE，不把 WebSocket 放进主路径。

原因：

- SSE 更适合服务端到客户端的单向流式生成。
- 浏览器原生支持文本流，中止生成可以直接用 `AbortController`。
- Agent Trace 和 token delta 与 SSE 事件天然匹配。
- WebSocket 更适合多人协同、IM、实时通知、低码协同编辑等双向场景。

后续如果加入多人评审、协同编辑、在线 IM 或实时告警，可以把 WS 作为独立实时通道引入，不污染当前生成链路。

## 架构设计

```mermaid
flowchart LR
  User["架构师 / 研发负责人"] --> UI["React Copilot Workbench"]
  UI --> Chat["多会话 Chat"]
  UI --> Task["任务模式 + 结构化表单"]
  UI --> Trace["Agent Trace Panel"]
  UI --> Review["Human Review Panel"]
  Chat --> BFF["Node.js BFF"]
  Task --> BFF
  BFF --> Auth["JWT Auth"]
  BFF --> Skill["Skill Runtime"]
  Skill --> Schema["Input / Output Schema"]
  Skill --> Guard["allowedTools / knowledgeScopes"]
  Guard --> Tools["Tool Calling"]
  Guard --> RAG["RAG Retriever"]
  Tools --> Search["searchKnowledge"]
  Tools --> Repo["analyzeRepository"]
  Tools --> Doc["generateArchitectureDocument"]
  RAG --> Vector["Local Embedding + Vector Search"]
  Vector --> Mongo["MongoDB Documents / Chunks"]
  BFF --> SSE["SSE Streaming"]
  SSE --> UI
  BFF --> Approval["Approval Store"]
  Approval --> Review
```

## 动态对应关系

```text
任务模式
  -> SkillDefinition
    -> inputSchema / outputSchema
    -> allowedTools
    -> knowledgeScopes
      -> RAG 检索上下文
      -> Tool Calling 执行结果
      -> Agent Trace
      -> Human Approval
```

示例：

- 选择“代码审查”时，Skill 会切换到 `code-review`，只允许调用 `searchKnowledge` 和 `analyzeRepository`。
- 选择“架构文档”时，Skill 会切换到 `architecture-review`，允许生成文档草稿并进入人工确认。
- RAG 引用来源会随 Skill 的 `knowledgeScopes` 和用户输入变化。

## API 设计

```text
GET  /api/copilot/skills
GET  /api/copilot/runtime
GET  /api/copilot/sessions
POST /api/copilot/sessions
GET  /api/copilot/sessions/:id
POST /api/copilot/sessions/:id/messages/stream
GET  /api/copilot/knowledge
GET  /api/copilot/knowledge/templates
POST /api/copilot/knowledge/templates/:id/import
POST /api/copilot/knowledge/upload
POST /api/copilot/approvals/:id/confirm
POST /api/copilot/approvals/:id/revise
POST /api/copilot/approvals/:id/reject
```

## 前端目录结构

```text
client/src
  api/
    client.ts              # REST + SSE 请求封装
  app/
    App.tsx                # 登录、Shell、子应用容器
  components/
    ui.tsx                 # 通用 UI 基础组件
  modules/
    copilot/
      CopilotWorkbench.tsx # MVP 主工作台
  platform/
    events.ts              # 全局事件总线
    i18n.ts                # 国际化入口
    microFrontend.tsx      # Wujie/本地子应用容器
    router.ts              # Shell 路由
    subapps.tsx            # 子应用 manifest
  main.tsx
  styles.less
```

本分支删除了与 AI Architecture Copilot MVP 无关的旧模块，避免“多个入口、同一功能”的产品噪音。

## 约束规范

### Skill 规范

- Skill 必须有稳定 id 和 version。
- Skill 必须声明 inputSchema 和 outputSchema。
- Skill 只能调用 allowedTools 中的工具。
- Skill 只能访问 knowledgeScopes 中的知识域。
- Skill 输出必须进入 Trace，不能黑盒执行。

### Tool 规范

- Tool 必须有明确输入输出。
- Tool 输入输出必须记录到 Trace。
- 高风险 Tool 必须进入人工确认。
- Tool 接口保持函数式，后续可迁移到 MCP Server。

### RAG 规范

- 文档必须带知识域 tags。
- 检索必须展示引用来源。
- 回答不得脱离引用来源编造事实。
- 不同 Skill 使用不同 knowledgeScopes。
- 生产环境可替换 embedding 和向量数据库，但调用契约不变。

### Human-in-the-loop 规范

- 架构文档生成、配置变更、代码修改等动作必须等待人工确认。
- 用户可确认、修改或拒绝。
- 审批结果必须持久化。
- Trace 必须标记 humanRequired。

### 前端工程规范

- 前端源码使用 TypeScript + Less。
- MVP 只保留 `modules/copilot` 主模块。
- 平台能力放在 `platform`。
- API 和 SSE 统一通过 `api/client.ts`。
- 运行前执行：

```bash
npm run typecheck --workspace client
npm run lint --workspace client
npm run build --workspace client
```

## 数据集合

MongoDB 连接：

```text
mongodb://127.0.0.1:27017/growth_ai_assistant
```

关键集合：

```text
users
documents
chunks
copilot_sessions
copilot_approvals
telemetry
```

## 后续演进

- 接入真实 LLM Provider。
- 将普通函数 Tool 迁移为 MCP Server。
- 接入 OpenAI Agents SDK 或 LangGraph 的 durable execution。
- PDF 文档接入真实 parser。
- RAG 替换为 pgvector / Milvus。
- Trace 接入 OpenTelemetry。
- Approval 支持暂停恢复和多人审批。
- 引入 WS 支持多人协同评审、在线 IM 和实时通知。
