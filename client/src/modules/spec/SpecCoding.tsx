import React, { useEffect, useState } from 'react';
import { Code2 } from 'lucide-react';
import { request, streamRequest } from '../../api/client';
import { Header, Status } from '../../components/ui';
import { AppEvents } from '../../platform/events';

export default function SpecCoding({ shell }) {
  const [specs, setSpecs] = useState([]);
  const [output, setOutput] = useState('');
  const [form, setForm] = useState({
    requirement: '企微内嵌智能问答助手',
    terminal: 'PC / H5 / 企业微信内嵌应用',
    risk: '多端登录、会话上下文、知识库幻觉、灰度回滚'
  });

  useEffect(() => { request('/api/enablement/specs').then((res) => setSpecs(res.specs)); }, []);

  async function generate() {
    setOutput('');
    await streamRequest('/api/enablement/specs/generate/stream', form, { delta: (data) => setOutput((prev) => prev + data.text) });
    shell.eventBus.emit(AppEvents.SPEC_GENERATED, form);
  }

  return (
    <section>
      <Header title="Spec Coding 工作台" desc="规格先行约束前后端、数据库、AI Skill、灰度和运维，避免需求到代码失真。" />
      <div className="two-column">
        <section className="panel">
          <h2>Spec 输入</h2>
          <div className="form-stack">
            {Object.entries(form).map(([key, value]) => (
              <label key={key}>{key}<textarea rows={3} value={value} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>
            ))}
            <button className="primary-button" onClick={generate}><Code2 size={16} />生成 Spec</button>
          </div>
          <div className="list">
            {specs.map((spec) => <div className="doc-row" key={spec._id}><strong>{spec.title}</strong><Status status={spec.status} /></div>)}
          </div>
        </section>
        <section className="panel"><h2>生成结果</h2><pre className="stream-box tall">{output || '点击生成 Spec Coding 文档...'}</pre></section>
      </div>
    </section>
  );
}
