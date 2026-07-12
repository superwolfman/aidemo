import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CheckCircle2, FileText, Pause, Play, RefreshCw, RotateCcw, Send, ShieldCheck, UploadCloud } from 'lucide-react';
import { request, streamRequest } from '../../api/client';
import { Card, Header, Status } from '../../components/ui';

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
    id: 'architecture-document',
    label: '架构文档',
    skillId: 'architecture-review',
    goal: '生成可审阅的 Markdown 架构文档草稿',
    prompt: '请生成一份可进入人工确认的架构文档草稿，要求包含背景、目标、模块图、接口、风险和上线计划。',
    deliverables: ['Markdown 草稿', '引用来源', '上线计划', '人工确认'],
    fields: [
      { key: 'docAudience', label: '读者对象', placeholder: '例：前端架构师、后端负责人、面试官' },
      { key: 'docScope', label: '文档范围', placeholder: '例：MVP 架构、Skill Runtime、Tool Calling、RAG、Trace' }
    ]
  }
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
  const [skillId, setSkillId] = useState('architecture-review');
  const [prompt, setPrompt] = useState('请评审一个面向企业内部研发团队的 AI 架构 Copilot，要求包含 Skill、Tool Calling、RAG、人工确认和 Trace。');
  const [taskModeId, setTaskModeId] = useState('architecture-review');
  const [form, setForm] = useState<Record<string, string>>({
    targetSystem: 'AI Architecture Copilot MVP',
    proposal: 'React + Node BFF + MongoDB + SSE + Skill Runtime + Tool Calling + RAG + Human-in-the-loop + Agent Trace'
  });
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [sources, setSources] = useState<any[]>([]);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [draftRevision, setDraftRevision] = useState('');
  const [documents, setDocuments] = useState<any[]>([]);
  const [knowledgeTemplates, setKnowledgeTemplates] = useState<any[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const activeSkill = useMemo(() => skills.find((skill) => skill.id === skillId), [skills, skillId]);
  const activeMode = useMemo(() => taskModes.find((mode) => mode.id === taskModeId) || taskModes[1], [taskModeId]);
  const messages = active?.messages || [];
  const replayTrace = replayIndex === null ? trace : trace.slice(0, replayIndex + 1);

  const load = useCallback(async () => {
    const [skillResult, sessionResult, knowledgeResult, templateResult] = await Promise.all([
      request('/api/copilot/skills'),
      request('/api/copilot/sessions'),
      request('/api/copilot/knowledge'),
      request('/api/copilot/knowledge/templates')
    ]);
    setSkills(skillResult.skills);
    setDocuments(knowledgeResult.documents);
    setKnowledgeTemplates(templateResult.templates || []);
    if (!sessionResult.sessions.length) {
      const created = await request('/api/copilot/sessions', { method: 'POST', body: JSON.stringify({ title: 'MVP 架构评审会话', skillId: 'architecture-review' }) });
      setSessions([created.session]);
      setActive(created.session);
      return;
    }
    setSessions(sessionResult.sessions);
    setActive((current) => current || sessionResult.sessions[0]);
    setSkillId((current) => sessionResult.sessions[0]?.activeSkillId || current);
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  async function createSession() {
    const result = await request('/api/copilot/sessions', { method: 'POST', body: JSON.stringify({ title: '新的架构会话', skillId }) });
    setSessions((items) => [result.session, ...items]);
    setActive(result.session);
    setTrace([]);
    setReplayIndex(null);
    setSources([]);
    setApproval(null);
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
  }

  async function review(action: 'confirm' | 'revise' | 'reject') {
    if (!approval) return;
    const result = await request(`/api/copilot/approvals/${approval._id}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ revision: draftRevision, note: action })
    });
    setApproval(result.approval);
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
        desc="多会话 AI Chat、Skill Runtime、Tool Calling、轻量 RAG、人工确认和 Agent Trace 的 MVP 工作台。"
        action={<Status status={running ? 'streaming' : 'mvp'} />}
      />

      <div className="copilot-layout">
        <aside className="copilot-sidebar">
          <section className="panel">
            <div className="section-head">
              <h2>会话历史</h2>
              <button className="secondary-button" onClick={createSession}>新会话</button>
            </div>
            <div className="session-list">
              {sessions.map((session) => (
                <button key={session._id} className={active?._id === session._id ? 'active' : ''} onClick={() => setActive(session)}>
                  <strong>{session.title}</strong>
                  <span>{session.messages?.length || 0} messages</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Skill 系统</h2>
            <div className="skill-list">
              {skills.map((skill) => (
                <button key={skill.id} className={skill.id === skillId ? 'active' : ''} onClick={() => setSkillId(skill.id)}>
                  <strong>{skill.name}</strong>
                  <span>v{skill.version} · {skill.allowedTools.join(', ')}</span>
                </button>
              ))}
            </div>
            {activeSkill ? (
              <Card title="SkillDefinition" text={`${schemaRequired(activeSkill.inputSchema)} -> ${activeSkill.knowledgeScopes.join(' / ')}`} />
            ) : null}
          </section>

          <section className="panel">
            <h2>RAG 知识库</h2>
            <label className="upload-button">
              <UploadCloud size={16} /> 上传 Markdown / TXT / PDF
              <input type="file" accept=".md,.markdown,.txt,.pdf" onChange={(event) => uploadKnowledge(event.target.files?.[0])} />
            </label>
            <div className="knowledge-template-list">
              {knowledgeTemplates.map((template) => (
                <button key={template.id} onClick={() => importTemplate(template.id)}>
                  <strong>{template.title}</strong>
                  <span>{template.tags?.join(' / ')}</span>
                </button>
              ))}
            </div>
            <div className="knowledge-mini-list">
              {documents.slice(0, 8).map((doc) => <span key={doc._id}><FileText size={13} />{doc.title}</span>)}
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
            {!messages.length ? <div className="empty">选择 Skill 后输入架构问题，Copilot 会流式输出并展示 Trace。</div> : null}
          </div>

          <div className="source-strip">
            {sources.map((source) => <span key={source._id}>{source.documentTitle} · score {source.score}</span>)}
          </div>

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
          </section>
        </aside>
      </div>
    </section>
  );
}
