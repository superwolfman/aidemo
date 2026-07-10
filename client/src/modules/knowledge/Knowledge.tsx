import React, { useEffect, useState } from 'react';
import { Database } from 'lucide-react';
import { request } from '../../api/client';
import { Header } from '../../components/ui';
import { AppEvents } from '../../platform/events';

export default function Knowledge({ shell }) {
  const [documents, setDocuments] = useState([]);
  const [title, setTitle] = useState('员工展业知识库：企微问答规范');
  const [content, setContent] = useState('员工在企业微信中回答客户问题时，必须基于知识库引用来源。无来源或低置信度问题应拒答或转人工，禁止编造收益承诺。');

  async function load() {
    const result = await request('/api/rag/documents');
    setDocuments(result.documents);
  }

  useEffect(() => { load().catch(console.error); }, []);

  async function add(event) {
    event.preventDefault();
    await request('/api/rag/documents', { method: 'POST', body: JSON.stringify({ title, content, tags: ['enablement', 'wecom'] }) });
    shell.eventBus.emit(AppEvents.KNOWLEDGE_DOCUMENT_CREATED, { title });
    await load();
  }

  return (
    <section>
      <Header title="内部展业知识库 RAG" desc="文档接入、切片、Embedding、召回、重排、上下文拼接、引用展示和防幻觉策略。" />
      <div className="two-column">
        <section className="panel">
          <h2>接入新文档</h2>
          <form className="form-stack" onSubmit={add}>
            <label>标题<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label>内容<textarea rows={8} value={content} onChange={(e) => setContent(e.target.value)} /></label>
            <button className="primary-button"><Database size={16} />写入知识库</button>
          </form>
        </section>
        <section className="panel">
          <h2>文档与向量切片</h2>
          <div className="list">
            {documents.map((doc) => <div className="doc-row" key={doc._id}><strong>{doc.title}</strong><span>{doc.chunkCount} chunks</span></div>)}
          </div>
        </section>
      </div>
    </section>
  );
}
