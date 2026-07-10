import React, { useEffect, useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { request, streamRequest } from '../../api/client';
import { Header } from '../../components/ui';
import { AppEvents } from '../../platform/events';

export default function Assistant({ shell }) {
  const [sessions, setSessions] = useState([]);
  const [active, setActive] = useState(null);
  const [question, setQuestion] = useState('企微里客户问产品适用场景，如何回答并避免幻觉？');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState([]);
  const [meta, setMeta] = useState(null);
  const prompts = [
    '企微授权登录失败，code 已经使用过，怎么排查？',
    '企微里客户问产品适用场景，如何回答并避免幻觉？',
    '客户问收益能不能保证，员工应该怎么回复？',
    '帮我生成一段客户拜访展业话术',
    '标注任务里车辆轨迹漂移应该如何处理？',
    '会话上下文和知识库事实应该怎么管理？'
  ];

  async function load() {
    const result = await request('/api/enablement/assistant/sessions');
    setSessions(result.sessions);
    setActive((current) => current || result.sessions[0] || null);
  }

  useEffect(() => { load().catch(console.error); }, []);

  async function createSession() {
    const result = await request('/api/enablement/assistant/sessions', {
      method: 'POST',
      body: JSON.stringify({ channel: 'wecom', title: '企微客户问答' })
    });
    setActive(result.session);
    await load();
  }

  async function ask() {
    let session = active;
    if (!session) {
      const result = await request('/api/enablement/assistant/sessions', {
        method: 'POST',
        body: JSON.stringify({ channel: 'wecom', title: '企微客户问答' })
      });
      session = result.session;
      setActive(session);
    }
    setAnswer('');
    setSources([]);
    setMeta(null);
    shell.eventBus.emit(AppEvents.ASSISTANT_ASKED, { question, sessionId: session._id });
    await streamRequest(`/api/enablement/assistant/sessions/${session._id}/stream`, { question }, {
      retrieval: (data) => setSources(data.contexts),
      answer_meta: (data) => setMeta(data),
      delta: (data) => setAnswer((prev) => prev + data.text)
    });
    await load();
  }

  return (
    <section>
      <Header title="企微内嵌智能问答助手" desc="SSE 流式问答、会话记忆、历史回溯、知识库引用、防幻觉和转人工策略。" />
      <div className="two-column wide-left">
        <section className="panel">
          <div className="prompt-row">
            {prompts.map((prompt) => <button key={prompt} onClick={() => setQuestion(prompt)}>{prompt}</button>)}
          </div>
          <div className="chat-input">
            <input value={question} onChange={(event) => setQuestion(event.target.value)} />
            <button className="primary-button icon-button" onClick={ask}><Send size={16} /></button>
          </div>
          {meta ? (
            <div className="answer-meta">
              <span>intent: {meta.intent}</span>
              <span>confidence: {Math.round(meta.confidence * 100)}%</span>
              <span>{meta.reliable ? '已命中可靠来源' : '低置信度'}</span>
            </div>
          ) : null}
          <div className="source-list">
            {sources.map((source) => (
              <div className="source-item" key={source._id}><strong>{source.documentTitle}</strong><span>score {source.score}</span></div>
            ))}
          </div>
          <pre className="stream-box">{answer || '等待企微员工提问...'}</pre>
        </section>
        <section className="panel">
          <div className="section-head">
            <h2>会话历史</h2>
            <button className="secondary-button" onClick={createSession}><RefreshCw size={16} />新会话</button>
          </div>
          <div className="list">
            {sessions.map((session) => (
              <button className={`list-item ${active?._id === session._id ? 'selected' : ''}`} key={session._id} onClick={() => setActive(session)}>
                <strong>{session.title}</strong>
                <span>{session.channel} · memory {(session.memory || []).length}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
