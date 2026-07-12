import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, FileText, Pause, RefreshCw, Send, ShieldCheck, UploadCloud } from 'lucide-react';
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
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [draftRevision, setDraftRevision] = useState('');
  const [documents, setDocuments] = useState<any[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const activeSkill = useMemo(() => skills.find((skill) => skill.id === skillId), [skills, skillId]);
  const messages = active?.messages || [];

  const load = useCallback(async () => {
    const [skillResult, sessionResult, knowledgeResult] = await Promise.all([
      request('/api/copilot/skills'),
      request('/api/copilot/sessions'),
      request('/api/copilot/knowledge')
    ]);
    setSkills(skillResult.skills);
    setDocuments(knowledgeResult.documents);
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
    setSources([]);
    setApproval(null);
    const assistant: Message = { id: `assistant-local-${Date.now()}`, role: 'assistant', content: '' };
    const optimistic: Session = {
      ...active,
      messages: [...messages, { id: `user-local-${Date.now()}`, role: 'user', content: nextPrompt }, assistant]
    };
    setActive(optimistic);

    try {
      await streamRequest(`/api/copilot/sessions/${active._id}/messages/stream`, { prompt: nextPrompt, skillId }, {
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

  async function review(action: 'confirm' | 'revise' | 'reject') {
    if (!approval) return;
    const result = await request(`/api/copilot/approvals/${approval._id}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ revision: draftRevision, note: action })
    });
    setApproval(result.approval);
    setTrace((items) => items.map((item) => item.id === 'human' ? { ...item, status: action === 'reject' ? 'failed' : 'success', output: { action } } : item));
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
            <div className="knowledge-mini-list">
              {documents.slice(0, 6).map((doc) => <span key={doc._id}><FileText size={13} />{doc.title}</span>)}
            </div>
          </section>
        </aside>

        <main className="copilot-chat panel">
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
            <textarea rows={3} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            <div>
              <button className="primary-button" disabled={running} onClick={() => sendPrompt()}><Send size={16} />发送</button>
              <button className="secondary-button" disabled={!running} onClick={stop}><Pause size={16} />停止生成</button>
              <button className="secondary-button" disabled={running || !messages.length} onClick={regenerate}><RefreshCw size={16} />重新生成</button>
            </div>
          </div>
        </main>

        <aside className="trace-panel">
          <section className="panel">
            <h2>Agent Trace</h2>
            <div className="trace-list">
              {trace.map((item) => (
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
