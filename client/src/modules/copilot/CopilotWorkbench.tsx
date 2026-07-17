import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bot, CheckCircle2, Copy, FileCode2, FileText, Pause, PencilLine, Play, RefreshCw, RotateCcw, Send, ShieldCheck, UploadCloud } from 'lucide-react';
import { request, streamRequest } from '../../api/client';
import { Header, Status } from '../../components/ui';

type Skill = {
  id: string;
  name: string;
  version: string;
  description: string;
  systemPrompt: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  allowedTools: string[];
  knowledgeScopes: string[];
};

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: any[];
  trace?: TraceStep[];
  approvalId?: string;
  createdAt?: string;
};

type Session = {
  _id: string;
  title: string;
  messages: Message[];
  activeSkillId: string;
};

type TraceStep = {
  id: string;
  name: string;
  status: 'running' | 'success' | 'waiting' | 'failed';
  durationMs?: number;
  tool?: string;
  input?: unknown;
  output?: unknown;
  tokenUsage?: number;
  humanRequired?: boolean;
  error?: string;
};

type RunStatus =
  | 'idle'
  | 'validating'
  | 'retrieving'
  | 'tool_running'
  | 'streaming'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

type RunState = {
  status: RunStatus;
  label: string;
  at?: string;
  scopes?: string[];
  provider?: string;
  model?: string;
  error?: string;
};

type Approval = {
  _id: string;
  status: 'pending' | 'confirmed' | 'revised' | 'rejected';
  documentDraft: string;
  finalDocument?: string;
  reviewedAt?: string;
};

type RuntimeStatus = {
  llm: {
    provider: string;
    mode: string;
    model: string;
    configured: boolean;
    streaming?: boolean;
    protocol?: string;
  };
  rag: {
    backend: string;
    mode?: string;
    vectorStore: string;
    retrievalBackend?: string;
    productionReady: boolean;
    index?: string;
    vectorPath?: string;
    dimensions?: number;
    connection?: string;
    embeddingProvider?: string;
    storeKind?: string;
    connected?: boolean;
    vectorSearchReady?: boolean;
    error?: string;
  };
  mcp: {
    enabled: boolean;
    transport: string;
    command: string;
  };
};

type ModelPreset = {
  id: string;
  label: string;
  provider: string;
  model: string;
  description: string;
  configured: boolean;
  active?: boolean;
};

type Artifact = {
  id: string;
  type: 'code' | 'test' | 'document' | 'context' | 'prd' | 'flow' | 'api' | 'task' | 'risk';
  title: string;
  language?: string;
  content: string | Record<string, unknown>;
};

type ArtifactReviewState = {
  status: 'draft' | 'editing' | 'confirmed';
  version: number;
  draft: string;
  history: Array<{ version: number; status: string; at: string }>;
};

type KnowledgeTemplate = {
  id: string;
  title: string;
  description?: string;
  tags: string[];
};

type EvalCase = {
  id: string;
  title: string;
  modeId: string;
  expected: string[];
  form: Record<string, string>;
};

type KnowledgeDocument = {
  _id: string;
  title: string;
  tags?: string[];
  chunkCount?: number;
  sourceType?: 'project-file' | 'upload' | 'template' | 'manual';
  sourcePath?: string;
  sourceUpdatedAt?: string;
  createdAt?: string;
};

type RagSource = {
  _id: string;
  documentTitle: string;
  content: string;
  score: number;
  tags?: string[];
  chunkIndex?: number;
  retrievalBackend?: string;
  sourceType?: string;
  sourcePath?: string;
};

type RagStatus = RuntimeStatus['rag'];

type RagDiagnostics = {
  rag?: RagStatus;
  query: string;
  scopes: string[];
  latencyMs?: number;
  sources: RagSource[];
  source: 'preview' | 'generation' | 'runtime';
};

type KnowledgeStats = {
  projectFiles: number;
  uploads: number;
  templates: number;
  chunks: number;
};

type VectorStoreHealth = {
  ok: boolean;
  live: boolean;
  message: string;
  status: RuntimeStatus['rag'];
  checks: Record<string, any>;
};

type TaskMode = {
  id: string;
  label: string;
  skillId: string;
  goal: string;
  prompt: string;
  fields: Array<{ key: string; label: string; placeholder: string }>;
  deliverables: string[];
};

const taskModes: TaskMode[] = [
  {
    id: 'product-workflow',
    label: '产品工作流',
    skillId: 'product-workflow',
    goal: '需求分析、页面原型、接口协议和任务拆解',
    prompt: '请把下面业务需求转成 AI 产品前端交付方案，输出需求摘要、用户流程、页面原型、接口协议、状态流转、研发任务拆解、风险和待确认问题。',
    deliverables: ['PRD 摘要', '页面原型', '接口协议', '任务拆解', '人工确认'],
    fields: [
      { key: 'businessRequirement', label: '业务需求', placeholder: '例：建设一个面向研发团队的 AI 工作流产品，支持需求输入、RAG 上下文、流式生成、Artifact 和人工确认' },
      { key: 'targetUsers', label: '目标用户', placeholder: '例：产品经理、前端工程师、后端工程师、算法工程师、技术负责人' },
      { key: 'deliveryGoal', label: '交付目标', placeholder: '例：一周内完成可演示 MVP，支持需求分析、页面结构、接口协议和研发任务拆解' },
      { key: 'constraints', label: '约束条件', placeholder: '例：React + TypeScript + Node BFF + SSE；高风险动作需要人工确认；输出必须可追踪引用来源' }
    ]
  },
  {
    id: 'engineering-productivity',
    label: '研发提效',
    skillId: 'engineering-productivity',
    goal: '生成代码、测试、文档和 PR 质量门禁',
    prompt: '请为前端团队设计一套 AI 研发提效工作流，要求覆盖代码生成、测试辅助、文档生成、PR 检查和人工确认。',
    deliverables: ['代码草案', '测试策略', '文档草稿', '质量门禁'],
    fields: [
      { key: 'workflowGoal', label: '提效目标', placeholder: '例：把组件开发、单测补全、PR Review 接入 AI 工作流' },
      { key: 'targetStack', label: '技术栈', placeholder: '例：React / TypeScript / Vite / Node BFF / MongoDB' },
      { key: 'qualityGate', label: '质量门禁', placeholder: '例：typecheck、lint、unit test、review checklist、人工确认' }
    ]
  },
  {
    id: 'requirement-analysis',
    label: '需求分析',
    skillId: 'requirement-analysis',
    goal: '把业务目标拆成可交付研发规格',
    prompt: '请对下面业务需求做架构级需求分析，输出目标、约束、风险、验收标准和待确认问题。',
    deliverables: ['业务目标拆解', '非功能约束', '验收标准', '待确认问题'],
    fields: [
      { key: 'businessGoal', label: '业务目标', placeholder: '例：建设一个面向企业研发团队的 AI 架构 Copilot' },
      { key: 'constraints', label: '关键约束', placeholder: '例：必须支持 Skill、Tool Calling、RAG、人工确认、Trace' }
    ]
  },
  {
    id: 'architecture-review',
    label: '架构评审',
    skillId: 'architecture-review',
    goal: '审查方案并生成可执行架构建议',
    prompt: '请评审下面系统方案，重点关注模块边界、数据流、可观测性、风险和演进路线。',
    deliverables: ['架构决策', '模块边界', '风险清单', '演进路线'],
    fields: [
      { key: 'targetSystem', label: '目标系统', placeholder: '例：AI Architecture Copilot MVP' },
      { key: 'proposal', label: '当前方案', placeholder: '例：React + Node BFF + MongoDB + SSE + RAG + Trace' }
    ]
  },
  {
    id: 'code-review',
    label: '代码审查',
    skillId: 'code-review',
    goal: '基于工程规范检查 PR 风险和测试缺口',
    prompt: '请对下面代码改动做工程级 Code Review，先列风险，再列修复建议和测试缺口。',
    deliverables: ['风险发现', '修复建议', '测试缺口', '合并建议'],
    fields: [
      { key: 'diffSummary', label: '变更摘要', placeholder: '例：新增 Copilot 路由、SSE 流式输出和 Trace 面板' },
      { key: 'riskLevel', label: '风险等级', placeholder: 'low / medium / high' }
    ]
  },
  {
    id: 'context-engineering',
    label: '上下文工程',
    skillId: 'context-engineering',
    goal: '设计 Prompt、RAG 上下文和工具状态拼接策略',
    prompt: '请为一个 AI Agent 任务设计 Context Engineering 方案，要求包含 Prompt Contract、上下文分层、RAG 拼接、压缩策略和幻觉防护。',
    deliverables: ['Prompt Contract', 'Context Pack', '压缩策略', 'Guardrails'],
    fields: [
      { key: 'agentGoal', label: 'Agent 目标', placeholder: '例：帮助研发团队完成架构评审、代码审查和文档生成' },
      { key: 'contextSources', label: '上下文来源', placeholder: '例：用户输入、会话历史、RAG 文档、工具结果、审批状态' },
      { key: 'riskControl', label: '风险控制', placeholder: '例：引用来源、工具权限、人工确认、Provider fallback' }
    ]
  }
];

const demoScenarios = [
  {
    title: 'AI 产品工作流',
    modeId: 'product-workflow',
    form: {
      businessRequirement: '为企业内部 AI 产品研发团队建设一个“需求到交付”Copilot 工作台。输入业务需求后，系统需要结合项目规范、AI Native 交互规范和接口约束，输出 PRD 摘要、页面原型、BFF 接口协议、状态流转、研发任务拆解和待确认风险。',
      targetUsers: '产品经理、前端工程师、后端工程师、算法工程师、技术负责人',
      deliveryGoal: '3 个工作日内完成可演示 MVP：支持需求输入、RAG 引用、SSE 流式分析、Artifact 产物、Trace 可审计和人工确认。',
      constraints: 'React + TypeScript + Node BFF + SSE；RAG 必须显示引用来源和 score；LLM 输出必须受 Skill schema 约束；高风险动作进入人工确认；结果可复制、可修改、可重新生成。'
    }
  },
  {
    title: 'AI 研发提效落地',
    modeId: 'engineering-productivity',
    form: {
      workflowGoal: '把组件开发、单测补全、PR Review 和技术文档生成接入 AI 工作流',
      targetStack: 'React / TypeScript / Vite / Node BFF / MongoDB / SSE',
      qualityGate: 'typecheck、lint、unit test、review checklist、人工确认'
    }
  },
  {
    title: 'Agent 上下文工程',
    modeId: 'context-engineering',
    form: {
      agentGoal: '帮助研发团队完成架构评审、代码审查和文档生成',
      contextSources: '用户输入、会话历史、RAG 文档、工具结果、审批状态',
      riskControl: '引用来源、工具权限、人工确认、Provider fallback'
    }
  },
  {
    title: '前端架构评审',
    modeId: 'architecture-review',
    form: {
      targetSystem: 'AI Architecture Copilot Open Source MVP',
      proposal: 'React Workbench + Skill Runtime + Tool Registry + RAG + Context Pack + Agent Trace'
    }
  }
];

const runLifecycle: Array<{ status: RunStatus; label: string }> = [
  { status: 'validating', label: '校验' },
  { status: 'retrieving', label: '检索' },
  { status: 'tool_running', label: '工具' },
  { status: 'streaming', label: '流式' },
  { status: 'waiting_approval', label: '确认' },
  { status: 'completed', label: '完成' }
];

const productWorkflowSlots: Array<{ type: Artifact['type']; title: string; desc: string }> = [
  { type: 'prd', title: 'PRD 摘要', desc: '目标、范围、用户角色、验收标准' },
  { type: 'flow', title: '页面结构', desc: '页面模块、用户流程、状态流转' },
  { type: 'api', title: '接口协议', desc: 'BFF 接口、请求响应、引用来源' },
  { type: 'task', title: '研发任务列表', desc: '前端、BFF、模型、测试任务拆解' },
  { type: 'risk', title: '风险和待确认问题', desc: '风险点、人工确认项、下一步决策' }
];

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlight(code: string) {
  return escapeHtml(code).replace(
    /\b(type|const|let|function|return|string|number|boolean|required|properties|array|object)\b/g,
    '<span class="code-keyword">$1</span>'
  );
}

function schemaRequired(schema: Record<string, unknown>) {
  const required = schema.required;
  return Array.isArray(required) ? required.join(', ') : 'schema';
}

function scorePercent(score?: number) {
  const safeScore = Math.max(0, Math.min(1, Number(score || 0)));
  return `${Math.round(safeScore * 100)}%`;
}

function sourceLabel(sourceType?: string) {
  if (sourceType === 'project-file') return '真实项目文件';
  if (sourceType === 'upload') return '用户上传';
  if (sourceType === 'template') return '模板';
  return '知识库';
}

function vectorReadinessLabel(rag?: RagStatus | null) {
  if (!rag) return 'runtime loading';
  if (rag.retrievalBackend === 'mongodb-atlas-vector-search' && rag.vectorSearchReady) return 'mongodb-atlas-vector-search';
  if (rag.backend === 'mongodb-atlas') return 'atlas configured · fallback until health passes';
  return 'local-hash fallback';
}

const workflowArchitectureNodes = [
  { id: 'input', title: '业务需求输入', desc: '目标用户、交付目标、约束条件、Prompt Contract' },
  { id: 'skill', title: 'Skill Runtime', desc: 'inputSchema / outputSchema / allowedTools / scopes' },
  { id: 'rag', title: 'RAG Context', desc: '项目文档、模板包、chunk score、citation' },
  { id: 'tool', title: 'Tool Calling', desc: '生成 PRD、页面原型、API、任务拆解' },
  { id: 'stream', title: 'SSE Streaming', desc: '流式输出、停止、重生成、fallback' },
  { id: 'artifact', title: 'Artifact Review', desc: '结构化产物、引用来源、审批历史' }
];

async function copyToClipboard(text: string) {
  await navigator.clipboard?.writeText(text);
}

function artifactToText(artifact: Artifact) {
  return typeof artifact.content === 'string' ? artifact.content : JSON.stringify(artifact.content, null, 2);
}

function artifactToMarkdown(artifact: Artifact, content = artifactToText(artifact)) {
  const language = artifact.language || (typeof artifact.content === 'string' ? 'md' : 'json');
  return [`# ${artifact.title}`, '', '```' + language, content, '```'].join('\n');
}

function downloadText(filename: string, text: string, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function renderWorkflowLines(lines: string[], keyPrefix: string) {
  const nodes: ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (!listItems.length) return;
    const items = listItems;
    nodes.push(
      <ul className="workflow-card-list" key={`${keyPrefix}-list-${nodes.length}`}>
        {items.map((item, index) => <li key={`${keyPrefix}-item-${index}`}>{item}</li>)}
      </ul>
    );
    listItems = [];
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }
    const listMatch = trimmed.match(/^[-*•]\s+(.+)$/);
    if (listMatch) {
      listItems.push(listMatch[1]);
      return;
    }
    flushList();
    const fieldMatch = trimmed.match(/^([\u4e00-\u9fa5A-Za-z0-9_\s/]+)[：:]\s*(.+)$/);
    if (fieldMatch && fieldMatch[1].length <= 18) {
      nodes.push(
        <div className="workflow-field-row" key={`${keyPrefix}-field-${index}`}>
          <span>{fieldMatch[1].trim()}</span>
          <strong>{fieldMatch[2].trim()}</strong>
        </div>
      );
      return;
    }
    nodes.push(<p key={`${keyPrefix}-p-${index}`}>{trimmed}</p>);
  });
  flushList();
  return nodes;
}

function WorkflowMessageContent({ content, streaming = false }: { content: string; streaming?: boolean }) {
  const blocks = content.split(/```/g);

  return (
    <div className="workflow-message-content">
      {blocks.map((block, index) => {
        if (index % 2 === 1) {
          const code = block.replace(/^\w+\n/, '');
          return (
            <section className="workflow-content-card workflow-code-card" key={`code-${index}`}>
              <div className="workflow-content-card-head">
                <strong>代码片段</strong>
                <button type="button" onClick={() => copyToClipboard(code)}><Copy size={13} />复制代码</button>
              </div>
              <pre><code dangerouslySetInnerHTML={{ __html: highlight(code) }} /></pre>
            </section>
          );
        }

        const text = block.trim();
        if (!text) return null;

        const isJson = text.startsWith('{') || text.startsWith('[');
        if (isJson) {
          return (
            <section className="workflow-content-card workflow-json-card" key={`json-${index}`}>
              <div className="workflow-content-card-head"><strong>结构化数据</strong></div>
              <pre>{text}</pre>
            </section>
          );
        }

        const isProviderError = /Provider 降级|LLM provider stream failed|Insufficient Balance|调用失败/i.test(text);
        const sections: Array<{ title: string; level: number; lines: string[] }> = [];
        let current: { title: string; level: number; lines: string[] } = { title: isProviderError ? 'Provider 降级' : '消息内容', level: 3, lines: [] };

        text.split('\n').forEach((line) => {
          const heading = line.trim().match(/^(#{1,3})\s+(.+)$/);
          if (heading) {
            if (current.lines.length || current.title !== '消息内容') sections.push(current);
            current = { title: heading[2], level: heading[1].length, lines: [] };
            return;
          }
          current.lines.push(line);
        });
        if (current.lines.length || !sections.length) sections.push(current);

        return sections.map((section, sectionIndex) => (
          <section
            className={`workflow-content-card ${isProviderError ? 'workflow-alert-card' : ''}`}
            key={`section-${index}-${sectionIndex}`}
          >
            <div className="workflow-content-card-head">
              <strong>{section.title}</strong>
              {section.level < 3 ? <span>section</span> : null}
            </div>
            <div className="workflow-content-card-body">
              {renderWorkflowLines(section.lines, `${index}-${sectionIndex}`)}
            </div>
          </section>
        ));
      })}
      {streaming ? <i className="stream-cursor" /> : null}
    </div>
  );
}

function getVisibleConversation(messages: Message[]) {
  const normalized = messages
    .filter((message) => message.content?.trim())
    .filter((message, index, list) => {
      const key = `${message.role}:${message.id || ''}:${message.content.trim()}`;
      return list.findIndex((item) => `${item.role}:${item.id || ''}:${item.content.trim()}` === key) === index;
    });
  const lastUserIndex = normalized.map((message) => message.role).lastIndexOf('user');
  if (lastUserIndex >= 0) return normalized.slice(lastUserIndex, lastUserIndex + 2);
  return normalized.slice(-1);
}

export default function CopilotWorkbench() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState<Session | null>(null);
  const [skillId, setSkillId] = useState('product-workflow');
  const [prompt, setPrompt] = useState('请把下面业务需求转成 AI 产品前端交付方案，输出需求摘要、用户流程、页面原型、接口协议、状态流转、研发任务拆解、风险和待确认问题。');
  const [taskModeId, setTaskModeId] = useState('product-workflow');
  const [form, setForm] = useState<Record<string, string>>({
    businessRequirement: '为企业内部 AI 产品研发团队建设一个“需求到交付”Copilot 工作台。输入业务需求后，系统需要结合项目规范、AI Native 交互规范和接口约束，输出 PRD 摘要、页面原型、BFF 接口协议、状态流转、研发任务拆解和待确认风险。',
    targetUsers: '产品经理、前端工程师、后端工程师、算法工程师、技术负责人',
    deliveryGoal: '3 个工作日内完成可演示 MVP：支持需求输入、RAG 引用、SSE 流式分析、Artifact 产物、Trace 可审计和人工确认。',
    constraints: 'React + TypeScript + Node BFF + SSE；RAG 必须显示引用来源和 score；LLM 输出必须受 Skill schema 约束；高风险动作进入人工确认；结果可复制、可修改、可重新生成。'
  });
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [openTraceIds, setOpenTraceIds] = useState<string[]>([]);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [sources, setSources] = useState<any[]>([]);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [approvalHistory, setApprovalHistory] = useState<Approval[]>([]);
  const [draftRevision, setDraftRevision] = useState('');
  const [runState, setRunState] = useState<RunState>({ status: 'idle', label: '等待输入' });
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [knowledgeStats, setKnowledgeStats] = useState<KnowledgeStats | null>(null);
  const [knowledgeTemplates, setKnowledgeTemplates] = useState<KnowledgeTemplate[]>([]);
  const [evalCases, setEvalCases] = useState<EvalCase[]>([]);
  const [selectedEvalCase, setSelectedEvalCase] = useState<EvalCase | null>(null);
  const [ragQuery, setRagQuery] = useState('');
  const [ragPreview, setRagPreview] = useState<RagSource[]>([]);
  const [ragDiagnostics, setRagDiagnostics] = useState<RagDiagnostics | null>(null);
  const [ragSearching, setRagSearching] = useState(false);
  const [projectSyncing, setProjectSyncing] = useState(false);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [artifactReviews, setArtifactReviews] = useState<Record<string, ArtifactReviewState>>({});
  const [selectedWorkflowArtifactType, setSelectedWorkflowArtifactType] = useState<Artifact['type']>('prd');
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [vectorHealth, setVectorHealth] = useState<VectorStoreHealth | null>(null);
  const [checkingVectorStore, setCheckingVectorStore] = useState(false);
  const [modelPresets, setModelPresets] = useState<ModelPreset[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const chatStreamRef = useRef<HTMLDivElement | null>(null);

  const activeSkill = useMemo(() => skills.find((skill) => skill.id === skillId), [skills, skillId]);
  const activeMode = useMemo(() => taskModes.find((mode) => mode.id === taskModeId) || taskModes[0], [taskModeId]);
  const messages = useMemo(() => active?.messages || [], [active?.messages]);
  const selectedWorkflowSlot = useMemo(
    () => productWorkflowSlots.find((slot) => slot.type === selectedWorkflowArtifactType) || productWorkflowSlots[0],
    [selectedWorkflowArtifactType]
  );
  const selectedWorkflowArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.type === selectedWorkflowSlot.type),
    [artifacts, selectedWorkflowSlot.type]
  );
  const selectedWorkflowReview = selectedWorkflowArtifact ? artifactReviews[selectedWorkflowArtifact.id] : null;
  const selectedWorkflowContent = selectedWorkflowArtifact
    ? selectedWorkflowReview?.draft || artifactToText(selectedWorkflowArtifact)
    : '';
  const visibleMessages = useMemo(() => getVisibleConversation(messages), [messages]);
  const replayTrace = replayIndex === null ? trace : trace.slice(0, replayIndex + 1);
  const visibleTrace = replayTrace.length ? replayTrace : trace;
  const activeScopes = activeSkill?.knowledgeScopes || ['architecture', 'standards'];
  const indexedChunks = documents.reduce((sum, doc) => sum + (doc.chunkCount || 0), 0);
  const activeTemplatePacks = knowledgeTemplates
    .filter((template) => template.tags?.some((tag) => activeScopes.includes(tag) || tag === 'copilot'))
    .slice(0, 4);
  const selectedModel = useMemo(
    () => modelPresets.find((model) => model.id === selectedModelId) || modelPresets[0],
    [modelPresets, selectedModelId]
  );
  const diagnosticSources = ragDiagnostics?.sources?.length ? ragDiagnostics.sources : ragPreview;
  const currentRunIndex = runLifecycle.findIndex((item) => item.status === runState.status);
  const evalChecks = useMemo(() => ({
    citations: sources.length > 0,
    prd: artifacts.some((artifact) => artifact.type === 'prd'),
    api: artifacts.some((artifact) => artifact.type === 'api'),
    trace: trace.length >= 6
  }), [artifacts, sources.length, trace.length]);
  const pendingWorkflowSummary = useMemo(() => {
    const fields = activeMode.fields
      .map((field) => ({ label: field.label, value: form[field.key] || field.placeholder }))
      .filter((item) => item.value);
    return {
      title: selectedEvalCase?.title || activeMode.label,
      fields
    };
  }, [activeMode, form, selectedEvalCase]);

  const load = useCallback(async () => {
    const [skillResult, sessionResult, knowledgeResult, templateResult, runtimeResult, modelResult, evalResult] = await Promise.all([
      request('/api/copilot/skills'),
      request('/api/copilot/sessions'),
      request('/api/copilot/knowledge'),
      request('/api/copilot/knowledge/templates'),
      request('/api/copilot/runtime'),
      request('/api/copilot/models'),
      request('/api/copilot/eval-cases')
    ]);
    setSkills(skillResult.skills);
    setDocuments(knowledgeResult.documents);
    setKnowledgeStats(knowledgeResult.stats || null);
    setKnowledgeTemplates(templateResult.templates || []);
    setRuntime(runtimeResult);
    setEvalCases(evalResult.cases || []);
    setVectorHealth(null);
    setRagDiagnostics((current) => current || {
      rag: runtimeResult.rag,
      query: '',
      scopes: [],
      sources: [],
      source: 'runtime'
    });
    setModelPresets(modelResult.models || []);
    setSelectedModelId((current) => current || modelResult.models?.find((item: ModelPreset) => item.active || item.configured)?.id || modelResult.models?.[0]?.id || '');
    const productSession = sessionResult.sessions.find((session: Session) => session.activeSkillId === 'product-workflow');
    if (!sessionResult.sessions.length || !productSession) {
      const created = await request('/api/copilot/sessions', { method: 'POST', body: JSON.stringify({ title: 'AI 产品工作流演示会话', skillId: 'product-workflow' }) });
      setSessions([created.session, ...sessionResult.sessions]);
      setActive(created.session);
      return;
    }
    setSessions(sessionResult.sessions);
    setActive((current) => current || productSession);
    setSkillId('product-workflow');
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  useEffect(() => {
    const el = chatStreamRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, running]);

  useEffect(() => {
    setArtifactReviews((current) => {
      const next = { ...current };
      for (const artifact of artifacts) {
        if (!next[artifact.id]) {
          next[artifact.id] = {
            status: 'draft',
            version: 1,
            draft: artifactToText(artifact),
            history: [{ version: 1, status: 'created', at: new Date().toISOString() }]
          };
        }
      }
      return next;
    });
  }, [artifacts]);

  useEffect(() => {
    setOpenTraceIds((ids) => ids.filter((id) => visibleTrace.some((item) => item.id === id)));
  }, [visibleTrace]);

  async function createSession() {
    const result = await request('/api/copilot/sessions', { method: 'POST', body: JSON.stringify({ title: `${activeMode.label}会话`, skillId }) });
    setSessions((items) => [result.session, ...items]);
    setActive(result.session);
    setTrace([]);
    setRunState({ status: 'idle', label: '等待输入' });
    setReplayIndex(null);
    setSources([]);
    setArtifacts([]);
    setArtifactReviews({});
    setApproval(null);
    setRagPreview([]);
    setRagDiagnostics(runtime ? { rag: runtime.rag, query: '', scopes: [], sources: [], source: 'runtime' } : null);
  }

  async function refreshActive(sessionId: string) {
    const result = await request(`/api/copilot/sessions/${sessionId}`);
    setActive(result.session);
    setSessions((items) => items.map((item) => item._id === sessionId ? result.session : item));
  }

  async function sendPrompt(nextPrompt = prompt) {
    if (!active || !nextPrompt.trim() || running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setRunState({ status: 'validating', label: '校验输入与选择 Skill' });
    setTrace([]);
    setReplayIndex(null);
    setSources([]);
    setArtifacts([]);
    setArtifactReviews({});
    setApproval(null);
    const assistant: Message = { id: `assistant-local-${Date.now()}`, role: 'assistant', content: '' };
    const optimistic: Session = {
      ...active,
      messages: [...messages, { id: `user-local-${Date.now()}`, role: 'user', content: nextPrompt }, assistant]
    };
    setActive(optimistic);

    try {
      await streamRequest(`/api/copilot/sessions/${active._id}/messages/stream`, {
        prompt: nextPrompt,
        skillId,
        mode: taskModeId,
        form,
        model: selectedModel ? {
          provider: selectedModel.provider,
          model: selectedModel.model
        } : undefined
      }, {
        run_status: (payload) => setRunState(payload),
        trace: (step) => setTrace((items) => [...items.filter((item) => item.id !== step.id), step]),
        sources: (payload) => {
          const nextSources = payload.sources || [];
          setSources(nextSources);
          setRagDiagnostics({
            rag: payload.rag || runtime?.rag,
            query: payload.query || nextPrompt,
            scopes: payload.scopes || activeScopes,
            latencyMs: payload.latencyMs,
            sources: nextSources,
            source: 'generation'
          });
        },
        artifacts: (payload) => setArtifacts(payload.artifacts || []),
        delta: (payload) => {
          setActive((current) => current ? {
            ...current,
            messages: current.messages.map((message) => message.id === assistant.id ? { ...message, content: message.content + payload.text } : message)
          } : current);
        },
        approval: (payload) => {
          setApproval(payload.approval);
          setDraftRevision(payload.approval.documentDraft || '');
        },
        final: async () => {
          await refreshActive(active._id);
        }
      }, controller.signal);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setRunState({ status: 'failed', label: '客户端错误', error: (error as Error).message });
        setTrace((items) => [...items, { id: 'client-error', name: '客户端错误', status: 'failed', error: (error as Error).message }]);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
    setRunState({ status: 'cancelled', label: '用户已停止生成' });
  }

  function regenerate() {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    sendPrompt(lastUser?.content || prompt);
  }

  function editAsPrompt(content: string) {
    setPrompt(content);
    requestAnimationFrame(() => {
      document.querySelector('.chat-composer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function updateArtifactReview(id: string, patch: Partial<ArtifactReviewState>) {
    setArtifactReviews((current) => {
      const base = current[id] || {
        status: 'draft',
        version: 1,
        draft: '',
        history: [{ version: 1, status: 'created', at: new Date().toISOString() }]
      };
      return { ...current, [id]: { ...base, ...patch } };
    });
  }

  function saveArtifactDraft(artifact: Artifact) {
    const current = artifactReviews[artifact.id];
    if (!current) return;
    const version = current.version + 1;
    updateArtifactReview(artifact.id, {
      status: 'draft',
      version,
      history: [{ version, status: 'edited', at: new Date().toISOString() }, ...current.history].slice(0, 6)
    });
  }

  function confirmArtifact(artifact: Artifact) {
    const current = artifactReviews[artifact.id];
    const version = current?.version || 1;
    updateArtifactReview(artifact.id, {
      status: 'confirmed',
      history: [{ version, status: 'confirmed', at: new Date().toISOString() }, ...(current?.history || [])].slice(0, 6)
    });
  }

  function exportArtifact(artifact: Artifact, format: 'md' | 'json') {
    const review = artifactReviews[artifact.id];
    const content = review?.draft || artifactToText(artifact);
    if (format === 'json') {
      downloadText(`${artifact.type}-${artifact.id}.json`, JSON.stringify({
        id: artifact.id,
        type: artifact.type,
        title: artifact.title,
        version: review?.version || 1,
        status: review?.status || 'draft',
        content
      }, null, 2), 'application/json;charset=utf-8');
      return;
    }
    downloadText(`${artifact.type}-${artifact.id}.md`, artifactToMarkdown(artifact, content), 'text/markdown;charset=utf-8');
  }

  function changeMode(mode: TaskMode) {
    setSelectedEvalCase(null);
    setTaskModeId(mode.id);
    setSkillId(mode.skillId);
    setPrompt(mode.prompt);
    setForm(Object.fromEntries(mode.fields.map((field) => [field.key, ''])));
  }

  function selectSkill(skill: Skill) {
    const mode = taskModes.find((item) => item.skillId === skill.id);
    if (mode) {
      changeMode(mode);
      return;
    }
    setSkillId(skill.id);
  }

  function selectSession(session: Session) {
    setSelectedEvalCase(null);
    setActive(session);
    setTrace([]);
    setRunState({ status: 'idle', label: '等待输入' });
    setReplayIndex(null);
    setSources([]);
    setArtifacts([]);
    setArtifactReviews({});
    setApproval(null);
    setRagPreview([]);
    setRagDiagnostics(runtime ? { rag: runtime.rag, query: '', scopes: [], sources: [], source: 'runtime' } : null);
    const mode = taskModes.find((item) => item.skillId === session.activeSkillId);
    if (mode) {
      setTaskModeId(mode.id);
      setSkillId(mode.skillId);
      setPrompt(mode.prompt);
      setForm(Object.fromEntries(mode.fields.map((field) => [field.key, ''])));
    }
  }

  function applyScenario(scenario: typeof demoScenarios[number]) {
    const mode = taskModes.find((item) => item.id === scenario.modeId) || taskModes[0];
    setSelectedEvalCase(null);
    setTaskModeId(mode.id);
    setSkillId(mode.skillId);
    setPrompt(mode.prompt);
    setForm(scenario.form);
    setArtifacts([]);
    setArtifactReviews({});
    setTrace([]);
    setRunState({ status: 'idle', label: '等待输入' });
    setSources([]);
    setApproval(null);
    setRagPreview([]);
    setRagDiagnostics(runtime ? { rag: runtime.rag, query: '', scopes: [], sources: [], source: 'runtime' } : null);
  }

  async function applyEvalCase(item: EvalCase) {
    const mode = taskModes.find((task) => task.id === item.modeId) || taskModes[0];
    setSelectedEvalCase(item);
    setTaskModeId(mode.id);
    setSkillId(mode.skillId);
    setPrompt(mode.prompt);
    setForm(item.form);
    const cleanSessionTitle = `${item.title} Eval 会话`;
    try {
      const created = await request('/api/copilot/sessions', {
        method: 'POST',
        body: JSON.stringify({ title: cleanSessionTitle, skillId: mode.skillId })
      });
      setSessions((items) => [created.session, ...items.filter((session) => session._id !== created.session._id)]);
      setActive(created.session);
    } catch {
      setActive((current) => current ? {
        ...current,
        title: cleanSessionTitle,
        activeSkillId: mode.skillId,
        messages: []
      } : current);
    }
    setArtifacts([]);
    setArtifactReviews({});
    setTrace([]);
    setSources([]);
    setApproval(null);
    setRunState({ status: 'idle', label: `已加载 Eval Case：${item.title}` });
    setRagPreview([]);
    setRagDiagnostics(runtime ? { rag: runtime.rag, query: '', scopes: [], sources: [], source: 'runtime' } : null);
  }

  function buildPromptFromMode() {
    const fieldText = activeMode.fields
      .map((field) => `${field.label}: ${form[field.key] || field.placeholder}`)
      .join('\n');
    return `${activeMode.prompt}\n\n${fieldText}`;
  }

  async function uploadKnowledge(file?: File) {
    if (!file) return;
    const isPdf = file.name.toLowerCase().endsWith('.pdf');
    const content = isPdf ? '' : await file.text();
    const result = await request('/api/copilot/knowledge/upload', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type,
        content,
        scopes: activeSkill?.knowledgeScopes || ['architecture']
      })
    });
    setDocuments((items) => [result.document, ...items]);
    setKnowledgeStats((stats) => stats ? { ...stats, uploads: stats.uploads + 1, chunks: stats.chunks + (result.document.chunkCount || 0) } : stats);
  }

  async function importTemplate(templateId: string) {
    const result = await request(`/api/copilot/knowledge/templates/${templateId}/import`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    setDocuments((items) => [result.document, ...items.filter((item) => item.title !== result.document.title)]);
    setKnowledgeStats((stats) => stats ? { ...stats, templates: stats.templates + 1, chunks: stats.chunks + (result.document.chunkCount || 0) } : stats);
    setRagQuery(result.document.title);
  }

  async function syncProjectKnowledge() {
    setProjectSyncing(true);
    try {
      await request('/api/copilot/knowledge/project/import', {
        method: 'POST',
        body: JSON.stringify({})
      });
      const knowledgeResult = await request('/api/copilot/knowledge');
      setDocuments(knowledgeResult.documents);
      setKnowledgeStats(knowledgeResult.stats || null);
      setRagQuery('AI Architecture Copilot RAG Agent Trace DeepSeek MongoDB Vector Search');
      setRagDiagnostics((current) => current ? { ...current, source: 'runtime' } : current);
    } finally {
      setProjectSyncing(false);
    }
  }

  async function checkVectorStore() {
    setCheckingVectorStore(true);
    try {
      const result = await request('/api/copilot/vector-store/health');
      setVectorHealth(result);
      setRuntime((current) => current ? { ...current, rag: result.status } : current);
      setRagDiagnostics((current) => ({
        rag: result.status,
        query: current?.query || '',
        scopes: current?.scopes || activeScopes,
        sources: current?.sources || [],
        source: current?.source || 'runtime'
      }));
    } finally {
      setCheckingVectorStore(false);
    }
  }

  async function searchKnowledgePreview() {
    setRagSearching(true);
    const nextQuery = ragQuery || buildPromptFromMode();
    try {
      const result = await request('/api/copilot/knowledge/search', {
        method: 'POST',
        body: JSON.stringify({
          query: nextQuery,
          scopes: activeScopes,
          limit: 4
        })
      });
      const nextSources = result.sources || [];
      setRagPreview(nextSources);
      setRagDiagnostics({
        rag: result.rag || runtime?.rag,
        query: result.query || nextQuery,
        scopes: result.scopes || activeScopes,
        latencyMs: result.latencyMs,
        sources: nextSources,
        source: 'preview'
      });
    } finally {
      setRagSearching(false);
    }
  }

  async function review(action: 'confirm' | 'revise' | 'reject') {
    if (!approval) return;
    const result = await request(`/api/copilot/approvals/${approval._id}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ revision: draftRevision, note: action })
    });
    setApproval(result.approval);
    setApprovalHistory((items) => [result.approval, ...items.filter((item) => item._id !== result.approval._id)].slice(0, 5));
    setTrace((items) => items.map((item) => item.id === 'human' ? { ...item, status: action === 'reject' ? 'failed' : 'success', output: { action } } : item));
  }

  function restoreTracePath() {
    const traceFromMessage = [...messages].reverse().find((message) => message.trace?.length)?.trace || trace;
    setTrace(traceFromMessage);
    setReplayIndex(traceFromMessage.length ? 0 : null);
    setOpenTraceIds(traceFromMessage[0]?.id ? [traceFromMessage[0].id] : []);
  }

  function nextReplayStep() {
    if (replayIndex === null) return;
    setReplayIndex((index) => {
      const next = Math.min((index || 0) + 1, trace.length - 1);
      if (trace[next]?.id) {
        setOpenTraceIds((ids) => ids.includes(trace[next].id) ? ids : [...ids, trace[next].id]);
      }
      return Number.isFinite(next) ? next : null;
    });
  }

  return (
    <section>
      <Header
        title="AI Architecture Copilot"
        desc="一个面向 AI 产品研发流程的 Copilot Workbench：从业务需求输入，到页面原型、接口协议、任务拆解、流式生成、Trace 和人工确认。"
        action={<Status status={running ? 'streaming' : 'mvp'} />}
      />

      <section className="copilot-command-bar">
        <div>
          <span>Live Copilot Workbench</span>
          <strong>{selectedModel ? `${selectedModel.provider} · ${selectedModel.model}` : runtime?.llm.mode === 'live' ? `${runtime.llm.provider} · ${runtime.llm.model}` : 'Local fallback runtime'}</strong>
          <p>主流程围绕 AI 产品交付组织：需求输入、Skill 约束、RAG 上下文、Artifact、Trace 和人工确认。</p>
          <div className={`atlas-readiness ${runtime?.rag.retrievalBackend === 'mongodb-atlas-vector-search' ? 'live' : 'fallback'}`}>
            <span>Retrieval Backend</span>
            <strong>{vectorReadinessLabel(runtime?.rag)}</strong>
            {runtime?.rag.error ? <em>{runtime.rag.error}</em> : null}
          </div>
        </div>
        <div className="command-side">
          <div className="command-metrics">
            <span><strong>{skills.length || 5}</strong> Skills</span>
            <span><strong>{knowledgeStats?.projectFiles || 0}</strong> Project files</span>
            <span><strong>{knowledgeStats?.chunks || indexedChunks || 0}</strong> Chunks</span>
            <span><strong>{trace.length}</strong> Trace steps</span>
          </div>
        </div>
      </section>

      <section className="workflow-blueprint">
        <article>
          <span>01</span>
          <strong>需求输入</strong>
          <p>业务需求、用户角色、交付目标和约束条件。</p>
        </article>
        <article>
          <span>02</span>
          <strong>RAG 上下文</strong>
          <p>按 Skill scope 检索真实项目文档并展示引用。</p>
        </article>
        <article>
          <span>03</span>
          <strong>流式生成</strong>
          <p>SSE 输出 Markdown、代码块和结构化结论。</p>
        </article>
        <article>
          <span>04</span>
          <strong>Artifact</strong>
          <p>输出 PRD、页面原型、接口协议和任务拆解。</p>
        </article>
        <article>
          <span>05</span>
          <strong>人工确认</strong>
          <p>高风险结果进入审批，支持确认、修改或拒绝。</p>
        </article>
      </section>

      <div className="copilot-layout">
        <aside className="copilot-sidebar">
          <section className="panel trace-card">
            <div className="section-head">
              <h2>会话历史</h2>
              <button className="secondary-button" onClick={createSession}>新会话</button>
            </div>
            <div className="session-list">
              {sessions.map((session) => (
                <button key={session._id} className={active?._id === session._id ? 'active' : ''} onClick={() => selectSession(session)}>
                  <strong>{session.title}</strong>
                  <span>{session.messages?.length || 0} messages</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Skill 系统</h2>
            {runtime ? (
              <div className="runtime-board">
                <span>LLM <strong>{runtime.llm.mode}</strong> · {selectedModel?.model || runtime.llm.model}{runtime.llm.streaming ? ' · streaming' : ''}</span>
                <span>RAG <strong>{runtime.rag.backend}</strong> · {runtime.rag.vectorStore}</span>
                <span>MCP <strong>{runtime.mcp.transport}</strong></span>
              </div>
            ) : null}
            <div className="skill-list">
              {skills.map((skill) => (
                <button key={skill.id} className={skill.id === skillId ? 'active' : ''} onClick={() => selectSkill(skill)}>
                  <strong>{skill.name}</strong>
                  <span>v{skill.version} · {skill.allowedTools.join(', ')}</span>
                </button>
              ))}
            </div>
            {activeSkill ? (
              <details className="schema-card">
                <summary>SkillDefinition · {schemaRequired(activeSkill.inputSchema)}</summary>
                <pre>{JSON.stringify({
                  id: activeSkill.id,
                  version: activeSkill.version,
                  inputSchema: activeSkill.inputSchema,
                  outputSchema: activeSkill.outputSchema,
                  allowedTools: activeSkill.allowedTools,
                  knowledgeScopes: activeSkill.knowledgeScopes
                }, null, 2)}</pre>
              </details>
            ) : null}
          </section>

          <section className="panel knowledge-context-panel">
            <div className="section-head">
              <h2>Knowledge Context</h2>
              <span>{documents.length} docs · {knowledgeStats?.chunks || indexedChunks || documents.length} chunks</span>
            </div>
            <div className="knowledge-source-stats">
              <span><strong>{knowledgeStats?.projectFiles || 0}</strong> 真实项目文件</span>
            <span><strong>{knowledgeStats?.uploads || 0}</strong> 上传文档</span>
              <span><strong>{knowledgeStats?.templates || 0}</strong> 模板</span>
            </div>
            {runtime ? (
              <div className={`vector-store-card ${runtime.rag.productionReady ? 'live' : 'fallback'}`}>
                <div>
                  <span>Vector Store</span>
                  <strong>{runtime.rag.vectorStore}</strong>
                  <em>{runtime.rag.retrievalBackend === 'mongodb-atlas-vector-search' ? 'live vector db' : 'local fallback'}</em>
                </div>
                <dl>
                  <dt>backend</dt>
                  <dd>{runtime.rag.backend}</dd>
                  <dt>retrieval</dt>
                  <dd>{runtime.rag.retrievalBackend || 'local-hash-fallback'}</dd>
                  <dt>mode</dt>
                  <dd>{runtime.rag.mode || '-'}</dd>
                  <dt>index</dt>
                  <dd>{runtime.rag.index || 'not configured'}</dd>
                  <dt>path</dt>
                  <dd>{runtime.rag.vectorPath || 'embedding'}</dd>
                  <dt>dims</dt>
                  <dd>{runtime.rag.dimensions || 96}</dd>
                  <dt>embedding</dt>
                  <dd>{runtime.rag.embeddingProvider || 'local-deterministic-embedding'}</dd>
                  <dt>connection</dt>
                  <dd>{runtime.rag.connection || 'in-process'}</dd>
                </dl>
                <button className="secondary-button vector-check-button" disabled={checkingVectorStore} onClick={checkVectorStore}>
                  {checkingVectorStore ? '检测中' : '检测真实向量库'}
                </button>
                {vectorHealth ? (
                  <details className="vector-health-detail" open>
                    <summary>{vectorHealth.live ? '已连接真实向量库' : '未连接真实向量库'} · {vectorHealth.message}</summary>
                    <pre>{JSON.stringify(vectorHealth.checks, null, 2)}</pre>
                  </details>
                ) : null}
                {!runtime.rag.productionReady && !vectorHealth ? (
                  <p>当前没有连接真实向量库。配置 `RAG_BACKEND=mongodb-atlas`、`MONGODB_ATLAS_URI` 和 Atlas Vector Search Index 后，点击检测会执行 `$vectorSearch`，并在检索结果中展示 `mongodb-atlas-vector-search`。</p>
                ) : null}
              </div>
            ) : null}
            <div className="scope-row">
              {activeScopes.map((scope) => <span key={scope}>{scope}</span>)}
            </div>
            <div className="knowledge-actions">
              <button className="secondary-button" disabled={projectSyncing} onClick={syncProjectKnowledge}>
                <RefreshCw size={15} />{projectSyncing ? '同步中' : '同步项目资料'}
              </button>
              <label className="upload-button">
                <UploadCloud size={16} /> 上传 Markdown / TXT / PDF
                <input type="file" accept=".md,.markdown,.txt,.pdf" onChange={(event) => uploadKnowledge(event.target.files?.[0])} />
              </label>
            </div>
            <div className="template-pack-list">
              <strong>可选 Context 模板包</strong>
              {activeTemplatePacks.map((template) => (
                <button key={template.id} onClick={() => importTemplate(template.id)}>
                  <strong>{template.title}</strong>
                  <span>{template.tags?.join(' / ')}</span>
                </button>
              ))}
            </div>
            <div className="rag-search">
              <input value={ragQuery} placeholder="按当前 Skill 知识域检索上下文..." onChange={(event) => setRagQuery(event.target.value)} />
              <button className="secondary-button" disabled={ragSearching} onClick={searchKnowledgePreview}>{ragSearching ? '检索中' : '检索预览'}</button>
            </div>
            <div className="rag-quality-panel">
              <div className="rag-quality-head">
                <div>
                  <strong>Retrieval Quality</strong>
                  <span>{ragDiagnostics?.source === 'generation' ? 'generation run' : ragDiagnostics?.source === 'preview' ? 'preview run' : 'runtime ready'}</span>
                </div>
                <em>{ragDiagnostics?.rag?.mode || runtime?.rag.mode || 'local'}</em>
              </div>
            <div className="rag-quality-metrics">
                <span><b>{ragDiagnostics?.rag?.backend || runtime?.rag.backend || '-'}</b> backend</span>
                <span><b>{ragDiagnostics?.rag?.retrievalBackend || runtime?.rag.retrievalBackend || '-'}</b> retrieval</span>
                <span><b>{ragDiagnostics?.latencyMs ?? '-'}</b> ms</span>
                <span><b>{diagnosticSources.length}</b> chunks</span>
              </div>
              <div className="rag-query-box">
                <strong>query</strong>
                <p>{ragDiagnostics?.query || ragQuery || '执行检索预览或生成后展示真实 query'}</p>
              </div>
              <div className="scope-row compact">
                {(ragDiagnostics?.scopes?.length ? ragDiagnostics.scopes : activeScopes).map((scope) => <span key={scope}>{scope}</span>)}
              </div>
              {ragDiagnostics?.rag?.error ? <div className="rag-error">fallback: {ragDiagnostics.rag.error}</div> : null}
            </div>
            <div className="rag-preview-list">
              {diagnosticSources.map((source) => (
                <article key={source._id}>
                  <div>
                    <strong>{source.documentTitle}</strong>
                    <span>score {Number(source.score || 0).toFixed(4)}</span>
                  </div>
                  <div className="score-bar"><i style={{ width: scorePercent(source.score) }} /></div>
                  <div className="rag-source-meta">
                    <span>{sourceLabel(source.sourceType)}</span>
                    <span>{source.retrievalBackend || ragDiagnostics?.rag?.backend || runtime?.rag.backend || 'local-hash'}</span>
                    {typeof source.chunkIndex === 'number' ? <span>chunk {source.chunkIndex + 1}</span> : null}
                    {source.tags?.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                  {source.sourcePath ? <code className="source-path">{source.sourcePath}</code> : null}
                  <p>{source.content}</p>
                </article>
              ))}
              {!diagnosticSources.length ? <span className="rag-empty">命中结果会展示 chunk、score、backend 和引用来源，并进入生成时的 citations。</span> : null}
            </div>
            <div className="knowledge-mini-list compact">
              {documents.slice(0, 8).map((doc) => (
                <span key={doc._id} title={doc.sourcePath || doc.title}>
                  <FileText size={13} />
                  <b>{sourceLabel(doc.sourceType)}</b>
                  {doc.sourcePath || doc.title}
                </span>
              ))}
            </div>
          </section>
        </aside>

        <main className="copilot-chat panel">
          <section className="task-console">
            <div className="section-head">
              <div>
                <h2>任务模式</h2>
                <p>选择一个 Skill 后，下面输入框会带上对应的上下文和交付约束。</p>
              </div>
              <span className="live-badge">{runtime?.llm.mode || 'fallback'}{runtime?.llm.streaming ? ' · streaming' : ''}</span>
            </div>
            <div className="mode-tabs">
              {taskModes.map((mode) => (
                <button key={mode.id} className={mode.id === taskModeId ? 'active' : ''} onClick={() => changeMode(mode)}>
                  <strong>{mode.label}</strong>
                  <span>{mode.goal}</span>
                </button>
              ))}
            </div>
            <div className="scenario-bar">
              <strong>推荐演示场景</strong>
              {demoScenarios.map((scenario) => (
                <button key={scenario.title} onClick={() => applyScenario(scenario)}>{scenario.title}</button>
              ))}
            </div>
            <div className="generation-meta compact">
              <strong>{activeMode.label}交付物</strong>
              {activeMode.deliverables.map((item) => (
                <span key={item}><CheckCircle2 size={14} />{item}</span>
              ))}
              <em>Skill: {activeSkill?.name || activeMode.skillId} · Tools: {activeSkill?.allowedTools.join(' / ') || '-'}</em>
            </div>
            <div className={`run-lifecycle ${runState.status}`}>
              <strong>AI Run Lifecycle</strong>
              {runLifecycle.map((item, index) => (
                <span
                  key={item.status}
                  className={[
                    index < currentRunIndex || runState.status === 'completed' ? 'done' : '',
                    index === currentRunIndex ? 'active' : '',
                    runState.status === 'failed' ? 'failed' : '',
                    runState.status === 'cancelled' ? 'cancelled' : ''
                  ].filter(Boolean).join(' ')}
                >
                  {item.label}
                </span>
              ))}
              <em>{runState.label}</em>
            </div>
          </section>

          <section className="workflow-chain-map">
            <div className="workflow-chain-head">
              <div>
                <strong>AI Product Workflow 链路架构</strong>
                <span>输入需求后，系统会按 Skill 约束检索知识库、调用工具、流式生成 Artifact，并在高风险节点进入人工确认。</span>
              </div>
              <em>{ragDiagnostics?.sources?.length || sources.length || 0} citations · {trace.length} trace steps</em>
            </div>
            <div className="workflow-chain-grid">
              {workflowArchitectureNodes.map((node, index) => (
                <article key={node.id}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{node.title}</strong>
                  <p>{node.desc}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="deliverable-overview">
            <div className="workflow-chain-head">
              <div>
                <strong>交付物总览</strong>
                <span>把 AI 输出收敛成可评审的产品资产，而不是散落在对话里的文本。</span>
              </div>
              <em>{artifacts.length} / {productWorkflowSlots.length} ready</em>
            </div>
            <div className="deliverable-card-grid">
              {productWorkflowSlots.map((slot) => {
                const artifact = artifacts.find((item) => item.type === slot.type);
                const review = artifact ? artifactReviews[artifact.id] : null;
                return (
                  <article key={slot.type} className={artifact ? 'ready' : 'pending'}>
                    <div>
                      <span>{slot.type.toUpperCase()}</span>
                      <em>{artifact ? review?.status || 'draft' : 'pending'}</em>
                    </div>
                    <strong>{artifact?.title || slot.title}</strong>
                    <p>{artifact ? (review?.draft || artifactToText(artifact)).slice(0, 130) : slot.desc}</p>
                    <small>{artifact ? `v${review?.version || 1} · 可编辑 / 可导出 / 可确认` : '生成后进入评审'}</small>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="eval-case-panel">
            <div className="workflow-chain-head">
              <div>
                <strong>Eval Cases</strong>
                <span>用真实产品场景验证引用命中、PRD 完整度、API 合理性和 Trace 可复盘。</span>
              </div>
              <em>{Object.values(evalChecks).filter(Boolean).length} / 4 passed</em>
            </div>
            <div className="eval-case-grid">
              {evalCases.map((item) => (
                <article key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <button type="button" onClick={() => void applyEvalCase(item)}>加载案例</button>
                  </div>
                  <p>{item.form.businessRequirement}</p>
                  <div className="eval-tags">
                    {item.expected.map((expected) => <span key={expected}>{expected}</span>)}
                  </div>
                </article>
              ))}
            </div>
            <div className="eval-scoreboard">
              <span className={evalChecks.citations ? 'pass' : ''}>命中知识来源：{sources.length} chunks</span>
              <span className={evalChecks.prd ? 'pass' : ''}>PRD 完整度：{evalChecks.prd ? '已生成' : '待生成'}</span>
              <span className={evalChecks.api ? 'pass' : ''}>API Contract：{evalChecks.api ? '已生成' : '待生成'}</span>
              <span className={evalChecks.trace ? 'pass' : ''}>Trace 可复盘：{trace.length} steps</span>
            </div>
          </section>

          <section className="product-workflow-board">
            <div className="workflow-column workflow-input-panel">
              <div className="column-head">
                <span>01</span>
                <div>
                  <h2>业务需求输入</h2>
                  <p>输入业务需求、用户角色、交付目标和约束条件。</p>
                </div>
              </div>
              <div className="generation-form workflow-fields">
                {activeMode.fields.map((field) => (
                  <label key={field.key}>
                    {field.label}
                    <input value={form[field.key] || ''} placeholder={field.placeholder} onChange={(event) => setForm((value) => ({ ...value, [field.key]: event.target.value }))} />
                  </label>
                ))}
              </div>
              <label>
                Prompt Contract
                <textarea
                  className="composer-input"
                  rows={5}
                  value={prompt}
                  placeholder="描述 AI 需要如何分析需求、输出页面原型、接口协议和任务拆解。"
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </label>
              <details className="model-select" title={selectedModel ? `${selectedModel.label} / ${selectedModel.provider} / ${selectedModel.model}` : '选择模型'}>
                <summary>
                  <span>{selectedModel?.label || '选择模型'}</span>
                  <em>{selectedModel?.provider || 'provider'} · {selectedModel?.configured ? 'live' : '未配置'}</em>
                </summary>
                <div className="model-menu">
                  <strong>模型</strong>
                  {selectedModel ? (
                    <div className="model-current">
                      <span>{selectedModel.label}</span>
                      <em>{selectedModel.provider} · {selectedModel.model} · {selectedModel.configured ? 'live' : '未配置'}</em>
                    </div>
                  ) : null}
                  {modelPresets.map((model) => (
                    <button
                      key={model.id}
                      className={model.id === selectedModel?.id ? 'active' : ''}
                      type="button"
                      onClick={(event) => {
                        setSelectedModelId(model.id);
                        event.currentTarget.closest('details')?.removeAttribute('open');
                      }}
                    >
                      <span>{model.label}{model.id === 'deepseek-reasoner' ? <b>推理</b> : null}</span>
                      <em>{model.description}</em>
                      <i>{model.provider} · {model.model} · {model.configured ? '可用' : '未配置'}</i>
                    </button>
                  ))}
                </div>
              </details>
              <details className="structured-fields">
                <summary>最终请求预览</summary>
                <label>
                  将发送给 Skill / RAG / Tool 的内容
                  <textarea rows={5} value={buildPromptFromMode()} readOnly />
                </label>
              </details>
              <div className="composer-actions workflow-actions">
                <span>{selectedModel?.configured ? `将使用 ${selectedModel.label}` : '当前模型未配置 Key，可能降级或失败'}</span>
                <div>
                  <button className="primary-button" disabled={running || !prompt.trim()} onClick={() => sendPrompt(buildPromptFromMode())}><Send size={16} />生成工作流</button>
                  <button className="secondary-button" disabled={!running} onClick={stop}><Pause size={16} />停止</button>
                  <button className="secondary-button" disabled={running || !messages.length} onClick={regenerate}><RefreshCw size={16} />重生成</button>
                </div>
              </div>
            </div>

            <div className="workflow-column workflow-stream-panel">
              <div className="column-head">
                <span>02</span>
                <div>
                  <h2>AI 流式分析过程</h2>
                  <p>需求摘要、用户角色、业务流程、页面模块会在这里逐步生成。</p>
                </div>
                {running ? <Status status="streaming" /> : null}
              </div>
              <div className="workflow-stream-stage">
                {runLifecycle.map((item, index) => (
                  <span
                    key={item.status}
                    className={[
                      index < currentRunIndex || runState.status === 'completed' ? 'done' : '',
                      index === currentRunIndex ? 'active' : ''
                    ].filter(Boolean).join(' ')}
                  >
                    {item.label}
                  </span>
                ))}
                <em>{runState.label}</em>
              </div>
              <div className="workflow-im-panel">
                <div className="workflow-im-header">
                  <div>
                    <strong>Copilot IM</strong>
                    <span>围绕当前需求实时生成、可复制、可回填 Prompt。</span>
                  </div>
                  <div className="workflow-im-meta">
                    <span>{visibleMessages.length} messages</span>
                    <span>{sources.length} citations</span>
                    <span>{runState.status}</span>
                  </div>
                </div>
                <div className="chat-stream workflow-chat-stream" ref={chatStreamRef}>
                  {visibleMessages.map((message) => (
                    <article key={message.id} className={`chat-message ${message.role}`}>
                      <div className="chat-role">{message.role === 'assistant' ? <Bot size={16} /> : 'U'}</div>
                      <div className="chat-message-body">
                        <div className="message-meta">
                          <strong>{message.role === 'assistant' ? 'AI Copilot' : 'User Request'}</strong>
                          <span>{message.role === 'assistant' ? `${message.sources?.length || sources.length} citations` : activeSkill?.name || 'Selected Skill'}</span>
                        </div>
                        <WorkflowMessageContent content={message.content} streaming={running && message.id === visibleMessages[visibleMessages.length - 1]?.id} />
                        <div className="message-actions">
                          <button type="button" onClick={() => copyToClipboard(message.content)}><Copy size={13} />复制回答</button>
                          <button type="button" onClick={() => editAsPrompt(message.content)}><PencilLine size={13} />编辑为输入</button>
                        </div>
                      </div>
                    </article>
                  ))}
                  {running ? (
                    <div className="stream-skeleton workflow-streaming-card">
                      <strong>AI 正在分析需求并生成 Artifact...</strong>
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : null}
                  {!visibleMessages.length ? (
                    <div className="chat-empty-state workflow-im-empty">
                      <Bot size={26} />
                      <strong>等待生成：{pendingWorkflowSummary.title}</strong>
                      <span>当前案例已加载。点击左侧“生成工作流”后，这里会按 SSE 动态展示用户请求、AI 分析、引用上下文和可操作回答。</span>
                      <div className="pending-workflow-preview">
                        {pendingWorkflowSummary.fields.slice(0, 4).map((item) => (
                          <em key={item.label}>
                            <b>{item.label}</b>
                            {item.value}
                          </em>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="workflow-column workflow-artifacts-panel">
              <div className="column-head">
                <span>03</span>
                <div>
                  <h2>Artifact 产物</h2>
                  <p>PRD、页面结构、接口协议、状态流转、风险和任务拆解。</p>
                </div>
              </div>
              <div className="artifact-workbench">
                <div className="artifact-rail" aria-label="Artifact 产物列表">
                  {productWorkflowSlots.map((slot) => {
                    const artifact = artifacts.find((item) => item.type === slot.type);
                    const review = artifact ? artifactReviews[artifact.id] : null;
                    const activeArtifact = selectedWorkflowSlot.type === slot.type;
                    return (
                      <button
                        key={slot.type}
                        type="button"
                        className={activeArtifact ? 'active' : ''}
                        onClick={() => setSelectedWorkflowArtifactType(slot.type)}
                      >
                        <span>{slot.type === 'api' ? <FileCode2 size={15} /> : <FileText size={15} />}</span>
                        <strong>{artifact?.title || slot.title}</strong>
                        <small>{slot.desc}</small>
                        <em className={artifact ? 'ready' : 'pending'}>
                          {artifact ? `v${review?.version || 1} · ${review?.status || 'draft'}` : '待生成'}
                        </em>
                      </button>
                    );
                  })}
                </div>

                <article className={`artifact-detail ${selectedWorkflowArtifact ? 'ready' : 'pending'}`}>
                  <header>
                    <div>
                      <span>{selectedWorkflowSlot.type === 'api' ? <FileCode2 size={16} /> : <FileText size={16} />}</span>
                      <div>
                        <h3>{selectedWorkflowArtifact?.title || selectedWorkflowSlot.title}</h3>
                        <p>{selectedWorkflowSlot.desc}</p>
                      </div>
                    </div>
                    <em>{selectedWorkflowArtifact ? `v${selectedWorkflowReview?.version || 1} · ${selectedWorkflowReview?.status || 'draft'}` : '等待生成'}</em>
                  </header>

                  {selectedWorkflowArtifact ? (
                    <>
                      <div className="artifact-detail-toolbar">
                        <button type="button" onClick={() => updateArtifactReview(selectedWorkflowArtifact.id, { status: selectedWorkflowReview?.status === 'editing' ? 'draft' : 'editing' })}>
                          {selectedWorkflowReview?.status === 'editing' ? '切换预览' : '编辑'}
                        </button>
                        <button type="button" onClick={() => copyToClipboard(selectedWorkflowContent)}>复制</button>
                        <button type="button" onClick={() => confirmArtifact(selectedWorkflowArtifact)}>确认</button>
                        <button type="button" onClick={() => exportArtifact(selectedWorkflowArtifact, 'md')}>导出 Markdown</button>
                        <button type="button" onClick={() => exportArtifact(selectedWorkflowArtifact, 'json')}>导出 JSON</button>
                      </div>

                      {selectedWorkflowReview?.status === 'editing' ? (
                        <div className="artifact-detail-editor">
                          <textarea value={selectedWorkflowReview.draft} onChange={(event) => updateArtifactReview(selectedWorkflowArtifact.id, { draft: event.target.value })} />
                          <button type="button" onClick={() => saveArtifactDraft(selectedWorkflowArtifact)}>保存为 v{(selectedWorkflowReview.version || 1) + 1}</button>
                        </div>
                      ) : (
                        <pre className="artifact-detail-preview">{selectedWorkflowContent}</pre>
                      )}

                      <details className="artifact-detail-history">
                        <summary>版本记录</summary>
                        {(selectedWorkflowReview?.history || []).map((item) => (
                          <span key={`${selectedWorkflowArtifact.id}-${item.version}-${item.at}`}>v{item.version} · {item.status} · {new Date(item.at).toLocaleTimeString()}</span>
                        ))}
                      </details>
                    </>
                  ) : (
                    <div className="artifact-empty-detail">
                      <FileText size={26} />
                      <strong>{selectedWorkflowSlot.title} 尚未生成</strong>
                      <span>点击“生成工作流”后，这里会展示可预览、可编辑、可确认和可导出的结构化产物。</span>
                    </div>
                  )}
                </article>
              </div>
            </div>
          </section>
        </main>

        <aside className="trace-panel">
          <section className="panel trace-card">
            <div className="section-head">
              <h2>Agent Trace</h2>
              <div className="trace-actions">
                <button className="secondary-button" onClick={restoreTracePath}><RotateCcw size={15} />路径还原</button>
                <button className="secondary-button" disabled={replayIndex === null || replayIndex >= trace.length - 1} onClick={nextReplayStep}><Play size={15} />下一步</button>
                <button className="secondary-button compact" disabled={!visibleTrace.length} onClick={() => setOpenTraceIds(visibleTrace.map((item) => item.id))}>展开</button>
                <button className="secondary-button compact" disabled={!openTraceIds.length} onClick={() => setOpenTraceIds([])}>收起</button>
              </div>
            </div>
            {visibleTrace.length ? (
              <div className="trace-audit-summary">
                <span>{visibleTrace.length} steps</span>
                <span>{visibleTrace.filter((item) => item.status === 'failed').length} failed</span>
                <span>{visibleTrace.filter((item) => item.humanRequired).length} human</span>
                <span>{visibleTrace.reduce((sum, item) => sum + (item.durationMs || 0), 0)}ms</span>
              </div>
            ) : null}
            <div className="trace-path">
              {visibleTrace.map((item, index) => {
                const expanded = openTraceIds.includes(item.id);
                return (
                  <div className="trace-step-row" key={item.id}>
                    <button
                      type="button"
                      className={`trace-step-toggle ${item.status}${expanded ? ' active' : ''}`}
                      onClick={() => setOpenTraceIds((ids) => ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id])}
                    >
                      {index + 1}. {item.name}
                      <span>{item.tool || item.status}</span>
                    </button>
                    {expanded ? (
                      <div className="trace-inline-detail">
                        <div>
                          <span className={`trace-dot ${item.status}`} />
                          <strong>{item.name}</strong>
                          <em>{item.durationMs || 0}ms · {item.tokenUsage || 0} tokens</em>
                        </div>
                        <pre>{JSON.stringify({ tool: item.tool, input: item.input, output: item.output, error: item.error, humanRequired: item.humanRequired }, null, 2)}</pre>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {!visibleTrace.length ? (
                <div className="trace-empty">
                  <strong>等待执行链路</strong>
                  <span>点击“生成工作流”后，会展示用户请求、Skill、RAG、Tool、LLM 和人工确认的真实执行步骤。</span>
                </div>
              ) : null}
            </div>
          </section>

          <section className="panel">
            <h2>引用来源</h2>
            <div className="citation-runtime">
              <span>{ragDiagnostics?.rag?.backend || runtime?.rag.backend || 'local-hash'}</span>
              <span>{ragDiagnostics?.rag?.retrievalBackend || runtime?.rag.retrievalBackend || 'local-hash'}</span>
              <span>{ragDiagnostics?.rag?.mode || runtime?.rag.mode || 'fallback'}</span>
              {typeof ragDiagnostics?.latencyMs === 'number' ? <span>{ragDiagnostics.latencyMs}ms</span> : null}
            </div>
            {sources.length ? (
              <div className="citation-list">
                {sources.map((source, index) => (
                  <article key={source._id}>
                    <div>
                      <strong>[{index + 1}] {source.documentTitle}</strong>
                      <span>score {Number(source.score || 0).toFixed(4)}</span>
                    </div>
                    <div className="citation-meta">
                      <span>{sourceLabel(source.sourceType)}</span>
                      <span>{source.retrievalBackend || ragDiagnostics?.rag?.backend || runtime?.rag.backend || 'local-hash'}</span>
                      {typeof source.chunkIndex === 'number' ? <span>chunk {source.chunkIndex + 1}</span> : null}
                      {source.tags?.slice(0, 3).map((tag: string) => <span key={tag}>{tag}</span>)}
                    </div>
                    {source.sourcePath ? <code className="source-path">{source.sourcePath}</code> : null}
                    <div className="score-bar"><i style={{ width: scorePercent(source.score) }} /></div>
                    <p>{source.content}</p>
                  </article>
                ))}
              </div>
            ) : <div className="empty">生成后这里会展示 RAG 命中的 chunk、score 和 citation。</div>}
          </section>

          <section className="panel">
            <h2>人工确认节点</h2>
            {approval ? (
              <div className="approval-box">
                <Status status={approval.status} />
                <textarea rows={10} value={draftRevision} onChange={(event) => setDraftRevision(event.target.value)} />
                <div className="approval-actions">
                  <button className="primary-button" onClick={() => review('confirm')}><ShieldCheck size={16} />确认</button>
                  <button className="secondary-button" onClick={() => review('revise')}>修改后执行</button>
                  <button className="danger-button" onClick={() => review('reject')}>拒绝</button>
                </div>
              </div>
            ) : <div className="empty">架构建议生成后，会在这里暂停等待确认。</div>}
            {approvalHistory.length ? (
              <div className="approval-history">
                <strong>审批历史</strong>
                {approvalHistory.map((item) => (
                  <span key={item._id}>{item.status} · {item.reviewedAt || 'just now'}</span>
                ))}
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </section>
  );
}
