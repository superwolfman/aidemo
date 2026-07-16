import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    productionReady: boolean;
    index?: string;
    vectorPath?: string;
    dimensions?: number;
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

type KnowledgeTemplate = {
  id: string;
  title: string;
  description?: string;
  tags: string[];
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

function MarkdownView({ content, streaming = false }: { content: string; streaming?: boolean }) {
  const blocks = content.split(/```/g);
  return (
    <div className="markdown-body">
      {blocks.map((block, index) => {
        if (index % 2 === 1) {
          const code = block.replace(/^\w+\n/, '');
          return (
            <div className="code-block" key={index}>
              <button type="button" onClick={() => copyToClipboard(code)}><Copy size={13} />复制代码</button>
              <pre><code dangerouslySetInnerHTML={{ __html: highlight(code) }} /></pre>
            </div>
          );
        }
        return block.split('\n').map((line, lineIndex) => {
          if (line.startsWith('### ')) return <h3 key={`${index}-${lineIndex}`}>{line.slice(4)}</h3>;
          if (line.startsWith('## ')) return <h2 key={`${index}-${lineIndex}`}>{line.slice(3)}</h2>;
          if (line.startsWith('# ')) return <h1 key={`${index}-${lineIndex}`}>{line.slice(2)}</h1>;
          if (line.startsWith('- ')) return <p className="md-list" key={`${index}-${lineIndex}`}>{line}</p>;
          if (!line.trim()) return null;
          return <p key={`${index}-${lineIndex}`}>{line}</p>;
        });
      })}
      {streaming ? <i className="stream-cursor" /> : null}
    </div>
  );
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
  const [ragQuery, setRagQuery] = useState('');
  const [ragPreview, setRagPreview] = useState<RagSource[]>([]);
  const [ragDiagnostics, setRagDiagnostics] = useState<RagDiagnostics | null>(null);
  const [ragSearching, setRagSearching] = useState(false);
  const [projectSyncing, setProjectSyncing] = useState(false);
  const [demoPreparing, setDemoPreparing] = useState(false);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [modelPresets, setModelPresets] = useState<ModelPreset[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const chatStreamRef = useRef<HTMLDivElement | null>(null);

  const activeSkill = useMemo(() => skills.find((skill) => skill.id === skillId), [skills, skillId]);
  const activeMode = useMemo(() => taskModes.find((mode) => mode.id === taskModeId) || taskModes[0], [taskModeId]);
  const messages = useMemo(() => active?.messages || [], [active?.messages]);
  const visibleMessages = useMemo(
    () => messages.filter((message) => message.role === 'assistant' && message.content.trim()),
    [messages]
  );
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

  const load = useCallback(async () => {
    const [skillResult, sessionResult, knowledgeResult, templateResult, runtimeResult, modelResult] = await Promise.all([
      request('/api/copilot/skills'),
      request('/api/copilot/sessions'),
      request('/api/copilot/knowledge'),
      request('/api/copilot/knowledge/templates'),
      request('/api/copilot/runtime'),
      request('/api/copilot/models')
    ]);
    setSkills(skillResult.skills);
    setDocuments(knowledgeResult.documents);
    setKnowledgeStats(knowledgeResult.stats || null);
    setKnowledgeTemplates(templateResult.templates || []);
    setRuntime(runtimeResult);
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

  function changeMode(mode: TaskMode) {
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
    setActive(session);
    setTrace([]);
    setRunState({ status: 'idle', label: '等待输入' });
    setReplayIndex(null);
    setSources([]);
    setArtifacts([]);
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
    setTaskModeId(mode.id);
    setSkillId(mode.skillId);
    setPrompt(mode.prompt);
    setForm(scenario.form);
    setArtifacts([]);
    setTrace([]);
    setRunState({ status: 'idle', label: '等待输入' });
    setSources([]);
    setApproval(null);
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

  async function prepareProductWorkflowDemo() {
    const scenario = demoScenarios[0];
    const mode = taskModes[0];
    setDemoPreparing(true);
    setTaskModeId(mode.id);
    setSkillId(mode.skillId);
    setPrompt(mode.prompt);
    setForm(scenario.form);
    setTrace([]);
    setReplayIndex(null);
    setSources([]);
    setArtifacts([]);
    setApproval(null);
    setRunState({ status: 'validating', label: '准备产品工作流演示上下文' });
    try {
      await request('/api/copilot/knowledge/project/import', {
        method: 'POST',
        body: JSON.stringify({})
      });
      const knowledgeResult = await request('/api/copilot/knowledge');
      setDocuments(knowledgeResult.documents);
      setKnowledgeStats(knowledgeResult.stats || null);
      const query = 'AI 产品工作流 需求分析 页面原型 接口协议 任务拆解 SSE RAG Agent Trace Human in the loop AI Native 前端交互规范';
      const searchResult = await request('/api/copilot/knowledge/search', {
        method: 'POST',
        body: JSON.stringify({
          query,
          scopes: mode.skillId === 'product-workflow' ? ['architecture', 'standards', 'ai-native', 'frontend'] : activeScopes,
          limit: 4
        })
      });
      const nextSources = searchResult.sources || [];
      setRagQuery(query);
      setRagPreview(nextSources);
      setRagDiagnostics({
        rag: searchResult.rag || runtime?.rag,
        query: searchResult.query || query,
        scopes: searchResult.scopes || ['architecture', 'standards', 'ai-native', 'frontend'],
        latencyMs: searchResult.latencyMs,
        sources: nextSources,
        source: 'preview'
      });
      setRunState({ status: 'idle', label: `Demo 已准备：已同步 ${knowledgeResult.stats?.projectFiles || 0} 个项目文件，预检索命中 ${nextSources.length} 个 chunk` });
    } finally {
      setDemoPreparing(false);
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
        </div>
        <div className="command-side">
          <button className="primary-button demo-run-button" disabled={demoPreparing || running} onClick={prepareProductWorkflowDemo}>
            <Play size={16} />{demoPreparing ? '准备中' : '导入资料并准备 Demo'}
          </button>
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
          <section className="panel">
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
              <div className="chat-stream workflow-chat-stream" ref={chatStreamRef}>
                {visibleMessages.map((message) => (
                  <article key={message.id} className={`chat-message ${message.role}`}>
                    <div className="chat-role">{message.role === 'assistant' ? <Bot size={16} /> : 'U'}</div>
                    <div className="chat-message-body">
                      <MarkdownView content={message.content} streaming={running && message.id === visibleMessages[visibleMessages.length - 1]?.id} />
                      <div className="message-actions">
                        <button type="button" onClick={() => copyToClipboard(message.content)}><Copy size={13} />复制回答</button>
                        <button type="button" onClick={() => editAsPrompt(message.content)}><PencilLine size={13} />编辑为输入</button>
                      </div>
                    </div>
                  </article>
                ))}
                {running ? (
                  <div className="stream-skeleton">
                    <strong>正在流式生成...</strong>
                    <span />
                    <span />
                    <span />
                  </div>
                ) : null}
                {!visibleMessages.length ? (
                  <div className="chat-empty-state">
                    <Bot size={26} />
                    <strong>等待生成 AI Product Workflow</strong>
                    <span>点击左侧“生成工作流”后，这里会展示流式分析过程。</span>
                  </div>
                ) : null}
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
              <div className="workflow-artifact-list">
                {productWorkflowSlots.map((slot) => {
                  const artifact = artifacts.find((item) => item.type === slot.type);
                  return (
                    <article key={slot.type} className={`artifact-card ${slot.type} ${artifact ? 'ready' : 'pending'}`}>
                      <div>
                        {slot.type === 'api' ? <FileCode2 size={15} /> : <FileText size={15} />}
                        <strong>{artifact?.title || slot.title}</strong>
                        <em>{artifact ? 'ready' : 'pending'}</em>
                      </div>
                      {artifact ? (
                        <pre>{typeof artifact.content === 'string' ? artifact.content : JSON.stringify(artifact.content, null, 2)}</pre>
                      ) : (
                        <p>{slot.desc}</p>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        </main>

        <aside className="trace-panel">
          <section className="panel">
            <div className="section-head">
              <h2>Agent Trace</h2>
              <div className="trace-actions">
                <button className="secondary-button" onClick={restoreTracePath}><RotateCcw size={15} />路径还原</button>
                <button className="secondary-button" disabled={replayIndex === null || replayIndex >= trace.length - 1} onClick={nextReplayStep}><Play size={15} />下一步</button>
              </div>
            </div>
            <div className="trace-path">
              {visibleTrace.map((item, index) => {
                const expanded = openTraceIds.includes(item.id);
                return (
                  <div className="trace-step-row" key={item.id}>
                    <button
                      type="button"
                      className={expanded ? 'active' : ''}
                      onClick={() => setOpenTraceIds((ids) => ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id])}
                    >
                      {index + 1}. {item.name}
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
            </div>
            <div className="trace-timeline">
              {visibleTrace.map((item) => (
                <i key={item.id} className={item.status} title={`${item.name} · ${item.durationMs || 0}ms`} />
              ))}
            </div>
            <div className="trace-list">
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
