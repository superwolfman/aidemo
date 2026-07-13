import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CheckCircle2, FileCode2, FileText, Pause, Play, RefreshCw, RotateCcw, Send, ShieldCheck, UploadCloud } from 'lucide-react';
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
  };
  rag: {
    backend: string;
    vectorStore: string;
    productionReady: boolean;
  };
  mcp: {
    enabled: boolean;
    transport: string;
    command: string;
  };
};

type Artifact = {
  id: string;
  type: 'code' | 'test' | 'document' | 'context';
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
  createdAt?: string;
};

type RagSource = {
  _id: string;
  documentTitle: string;
  content: string;
  score: number;
  tags?: string[];
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

const releaseTracks = [
  {
    version: 'v1.0',
    title: 'AI Dev Workflow',
    status: 'implemented',
    items: ['代码草案 Artifact', '测试策略', '文档草稿', 'PR 质量门禁']
  },
  {
    version: 'v2.0',
    title: 'RAG & Context',
    status: 'implemented',
    items: ['知识域过滤', '引用来源', 'Context Pack', 'Prompt Contract']
  },
  {
    version: 'v3.0',
    title: 'Agent Runtime',
    status: 'implemented',
    items: ['Skill Runtime', 'Tool Calling', 'SSE Trace', 'Human-in-the-loop']
  },
  {
    version: 'v4.0',
    title: 'Open Platform',
    status: 'poc',
    items: ['MCP Server', 'LLM Provider', 'Eval 指标', '向量库替换']
  }
];

const benchmarkPatterns = [
  'Task-first：围绕研发任务输入上下文，减少无关菜单和展示页',
  'Artifact-first：输出代码、测试、文档和 Context Pack，而不是只返回聊天文本',
  'Trace-first：展示工具输入输出、耗时、token、错误和人工确认',
  'Guardrails：Skill schema、allowedTools、knowledgeScopes 和审批开关进入运行时'
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

function MarkdownView({ content }: { content: string }) {
  const blocks = content.split(/```/g);
  return (
    <div className="markdown-body">
      {blocks.map((block, index) => {
        if (index % 2 === 1) {
          const code = block.replace(/^\w+\n/, '');
          return <pre key={index}><code dangerouslySetInnerHTML={{ __html: highlight(code) }} /></pre>;
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
    </div>
  );
}

export default function CopilotWorkbench() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState<Session | null>(null);
  const [skillId, setSkillId] = useState('engineering-productivity');
  const [prompt, setPrompt] = useState('请为前端团队设计一套 AI 研发提效工作流，要求覆盖代码生成、测试辅助、文档生成、PR 检查和人工确认。');
  const [taskModeId, setTaskModeId] = useState('engineering-productivity');
  const [form, setForm] = useState<Record<string, string>>({
    workflowGoal: '把组件开发、单测补全、PR Review 和技术文档生成接入 AI 工作流',
    targetStack: 'React / TypeScript / Vite / Node BFF / MongoDB / SSE',
    qualityGate: 'typecheck、lint、unit test、review checklist、人工确认'
  });
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [sources, setSources] = useState<any[]>([]);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [approvalHistory, setApprovalHistory] = useState<Approval[]>([]);
  const [draftRevision, setDraftRevision] = useState('');
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [knowledgeTemplates, setKnowledgeTemplates] = useState<KnowledgeTemplate[]>([]);
  const [ragQuery, setRagQuery] = useState('');
  const [ragPreview, setRagPreview] = useState<RagSource[]>([]);
  const [ragSearching, setRagSearching] = useState(false);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const activeSkill = useMemo(() => skills.find((skill) => skill.id === skillId), [skills, skillId]);
  const activeMode = useMemo(() => taskModes.find((mode) => mode.id === taskModeId) || taskModes[1], [taskModeId]);
  const messages = active?.messages || [];
  const replayTrace = replayIndex === null ? trace : trace.slice(0, replayIndex + 1);
  const activeScopes = activeSkill?.knowledgeScopes || ['architecture', 'standards'];
  const indexedChunks = documents.reduce((sum, doc) => sum + (doc.chunkCount || 0), 0);
  const activeTemplatePacks = knowledgeTemplates
    .filter((template) => template.tags?.some((tag) => activeScopes.includes(tag) || tag === 'copilot'))
    .slice(0, 4);

  const load = useCallback(async () => {
    const [skillResult, sessionResult, knowledgeResult, templateResult, runtimeResult] = await Promise.all([
      request('/api/copilot/skills'),
      request('/api/copilot/sessions'),
      request('/api/copilot/knowledge'),
      request('/api/copilot/knowledge/templates'),
      request('/api/copilot/runtime')
    ]);
    setSkills(skillResult.skills);
    setDocuments(knowledgeResult.documents);
    setKnowledgeTemplates(templateResult.templates || []);
    setRuntime(runtimeResult);
    const productivitySession = sessionResult.sessions.find((session: Session) => session.activeSkillId === 'engineering-productivity');
    if (!sessionResult.sessions.length || !productivitySession) {
      const created = await request('/api/copilot/sessions', { method: 'POST', body: JSON.stringify({ title: 'AI 研发提效演示会话', skillId: 'engineering-productivity' }) });
      setSessions([created.session, ...sessionResult.sessions]);
      setActive(created.session);
      return;
    }
    setSessions(sessionResult.sessions);
    setActive((current) => current || productivitySession);
    setSkillId('engineering-productivity');
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  async function createSession() {
    const result = await request('/api/copilot/sessions', { method: 'POST', body: JSON.stringify({ title: `${activeMode.label}会话`, skillId }) });
    setSessions((items) => [result.session, ...items]);
    setActive(result.session);
    setTrace([]);
    setReplayIndex(null);
    setSources([]);
    setArtifacts([]);
    setApproval(null);
    setRagPreview([]);
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
      await streamRequest(`/api/copilot/sessions/${active._id}/messages/stream`, { prompt: nextPrompt, skillId, mode: taskModeId, form }, {
        trace: (step) => setTrace((items) => [...items.filter((item) => item.id !== step.id), step]),
        sources: (payload) => setSources(payload.sources || []),
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
  }

  function regenerate() {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    sendPrompt(lastUser?.content || prompt);
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
    setReplayIndex(null);
    setSources([]);
    setArtifacts([]);
    setApproval(null);
    setRagPreview([]);
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
    setSources([]);
    setApproval(null);
    setRagPreview([]);
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
  }

  async function importTemplate(templateId: string) {
    const result = await request(`/api/copilot/knowledge/templates/${templateId}/import`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    setDocuments((items) => [result.document, ...items.filter((item) => item.title !== result.document.title)]);
    setRagQuery(result.document.title);
  }

  async function searchKnowledgePreview() {
    setRagSearching(true);
    try {
      const result = await request('/api/copilot/knowledge/search', {
        method: 'POST',
        body: JSON.stringify({
          query: ragQuery || buildPromptFromMode(),
          scopes: activeScopes,
          limit: 4
        })
      });
      setRagPreview(result.sources || []);
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
  }

  function nextReplayStep() {
    if (replayIndex === null) return;
    setReplayIndex((index) => {
      const next = Math.min((index || 0) + 1, trace.length - 1);
      return Number.isFinite(next) ? next : null;
    });
  }

  return (
    <section>
      <Header
        title="AI Architecture Copilot"
        desc="面向前端架构师和 AI 前端工程师的开源 MVP：研发提效、RAG/Agent、Context Engineering、实时工作流和可审计 Trace。"
        action={<Status status={running ? 'streaming' : 'mvp'} />}
      />

      <section className="product-command">
        <div>
          <span>Open Source Interview Edition</span>
          <strong>AI Dev Workflow + RAG + Agent Trace</strong>
          <p>参考 Cursor、Copilot Workspace、Dify、LangSmith 的产品形态，收敛为一个研发任务工作台：输入需求，加载上下文，调用工具，产出 Artifact，并进入人工确认。</p>
        </div>
        <div className="command-metrics">
          <span><strong>5</strong> Skills</span>
          <span><strong>5</strong> Tools</span>
          <span><strong>4</strong> Artifact types</span>
          <span><strong>MCP</strong> POC</span>
        </div>
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
                <span>LLM <strong>{runtime.llm.mode}</strong> · {runtime.llm.model}</span>
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
              <details className="schema-card" open>
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
              <span>{documents.length} docs · {indexedChunks || documents.length} chunks</span>
            </div>
            <div className="scope-row">
              {activeScopes.map((scope) => <span key={scope}>{scope}</span>)}
            </div>
            <label className="upload-button">
              <UploadCloud size={16} /> 上传 Markdown / TXT / PDF
              <input type="file" accept=".md,.markdown,.txt,.pdf" onChange={(event) => uploadKnowledge(event.target.files?.[0])} />
            </label>
            <div className="template-pack-list">
              <strong>Context 模板包</strong>
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
            <div className="rag-preview-list">
              {ragPreview.map((source) => (
                <article key={source._id}>
                  <div>
                    <strong>{source.documentTitle}</strong>
                    <span>score {source.score}</span>
                  </div>
                  <p>{source.content}</p>
                </article>
              ))}
              {!ragPreview.length ? <span className="rag-empty">命中结果会展示 chunk、score 和引用来源，并进入生成时的 citations。</span> : null}
            </div>
            <div className="knowledge-mini-list compact">
              {documents.slice(0, 5).map((doc) => <span key={doc._id}><FileText size={13} />{doc.title}</span>)}
            </div>
          </section>
        </aside>

        <main className="copilot-chat panel">
          <section className="generation-console">
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
            <div className="generation-meta">
              <strong>{activeMode.label}交付物</strong>
              {activeMode.deliverables.map((item) => (
                <span key={item}><CheckCircle2 size={14} />{item}</span>
              ))}
              <em>Skill: {activeSkill?.name || activeMode.skillId} · Tools: {activeSkill?.allowedTools.join(' / ') || '-'}</em>
            </div>
            <div className="generation-form">
              <label>
                生成目标
                <textarea rows={2} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
              </label>
              {activeMode.fields.map((field) => (
                <label key={field.key}>
                  {field.label}
                  <input value={form[field.key] || ''} placeholder={field.placeholder} onChange={(event) => setForm((value) => ({ ...value, [field.key]: event.target.value }))} />
                </label>
              ))}
            </div>
          </section>

          <div className="chat-stream">
            {messages.map((message) => (
              <article key={message.id} className={`chat-message ${message.role}`}>
                <div className="chat-role">{message.role === 'assistant' ? <Bot size={16} /> : 'U'}</div>
                <MarkdownView content={message.content} />
              </article>
            ))}
            {running ? (
              <div className="stream-skeleton">
                <span />
                <span />
                <span />
              </div>
            ) : null}
            {!messages.length ? <div className="empty">选择 Skill 后输入架构问题，Copilot 会流式输出并展示 Trace。</div> : null}
          </div>

          <details className="source-detail" open={Boolean(sources.length)}>
            <summary>引用来源 · {sources.length}</summary>
            <div className="source-strip">
              {sources.map((source) => (
                <span key={source._id} title={source.content}>{source.documentTitle} · score {source.score}</span>
              ))}
            </div>
          </details>

          <section className="artifact-panel">
            <div className="section-head">
              <h2>Artifacts</h2>
              <span>{artifacts.length} generated</span>
            </div>
            {artifacts.length ? (
              <div className="artifact-grid">
                {artifacts.map((artifact) => (
                  <article key={artifact.id} className={`artifact-card ${artifact.type}`}>
                    <div>
                      {artifact.type === 'code' ? <FileCode2 size={15} /> : <FileText size={15} />}
                      <strong>{artifact.title}</strong>
                      <em>{artifact.type}</em>
                    </div>
                    <pre>{typeof artifact.content === 'string' ? artifact.content : JSON.stringify(artifact.content, null, 2)}</pre>
                  </article>
                ))}
              </div>
            ) : (
              <div className="artifact-empty">
                <article><FileCode2 size={16} /><strong>Code Draft</strong><span>组件、Hook、Mock 草案</span></article>
                <article><FileText size={16} /><strong>Test Plan</strong><span>单测、契约测试、回归点</span></article>
                <article><FileText size={16} /><strong>Context Pack</strong><span>Prompt、RAG、工具状态分层</span></article>
              </div>
            )}
          </section>

          <div className="chat-composer">
            <label>
              最终请求预览
              <textarea rows={4} value={buildPromptFromMode()} readOnly />
            </label>
            <div>
              <button className="primary-button" disabled={running} onClick={() => sendPrompt(buildPromptFromMode())}><Send size={16} />生成</button>
              <button className="secondary-button" disabled={!running} onClick={stop}><Pause size={16} />停止生成</button>
              <button className="secondary-button" disabled={running || !messages.length} onClick={regenerate}><RefreshCw size={16} />重新生成</button>
            </div>
          </div>
        </main>

        <aside className="trace-panel">
          <section className="panel benchmark-panel">
            <h2>Product Benchmarks</h2>
            <div className="benchmark-list">
              {benchmarkPatterns.map((item) => (
                <span key={item}><CheckCircle2 size={14} />{item}</span>
              ))}
            </div>
          </section>

          <section className="panel release-panel">
            <h2>Release Plan</h2>
            <div className="release-stack">
              {releaseTracks.map((track) => (
                <article key={track.version}>
                  <div>
                    <strong>{track.version}</strong>
                    <span>{track.status}</span>
                  </div>
                  <h3>{track.title}</h3>
                  <p>{track.items.join(' / ')}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="section-head">
              <h2>Agent Trace</h2>
              <div className="trace-actions">
                <button className="secondary-button" onClick={restoreTracePath}><RotateCcw size={15} />路径还原</button>
                <button className="secondary-button" disabled={replayIndex === null || replayIndex >= trace.length - 1} onClick={nextReplayStep}><Play size={15} />下一步</button>
              </div>
            </div>
            <div className="trace-path">
              {(replayTrace.length ? replayTrace : trace).map((item, index) => (
                <span key={item.id} className={index === replayIndex ? 'active' : ''}>{index + 1}. {item.name}</span>
              ))}
            </div>
            <div className="trace-timeline">
              {(replayTrace.length ? replayTrace : trace).map((item) => (
                <i key={item.id} className={item.status} title={`${item.name} · ${item.durationMs || 0}ms`} />
              ))}
            </div>
            <div className="trace-list">
              {(replayTrace.length ? replayTrace : trace).map((item) => (
                <details key={item.id} open={item.status === 'waiting' || item.status === 'failed'}>
                  <summary>
                    <span className={`trace-dot ${item.status}`} />
                    <strong>{item.name}</strong>
                    <em>{item.durationMs || 0}ms · {item.tokenUsage || 0} tokens</em>
                  </summary>
                  <pre>{JSON.stringify({ tool: item.tool, input: item.input, output: item.output, error: item.error, humanRequired: item.humanRequired }, null, 2)}</pre>
                </details>
              ))}
            </div>
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
