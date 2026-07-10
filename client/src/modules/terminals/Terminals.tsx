import React, { useEffect, useState } from 'react';
import { request } from '../../api/client';
import { Card, Header, Status } from '../../components/ui';

export default function Terminals() {
  const [terminals, setTerminals] = useState([]);
  const [wecom, setWecom] = useState(null);

  useEffect(() => {
    request('/api/enablement/terminals').then((res) => setTerminals(res.terminals));
    request('/api/enablement/wecom/sandbox').then(setWecom);
  }, []);

  return (
    <section>
      <Header title="员工展业三端" desc="PC、H5、企业微信内嵌应用作为独立子应用，共用基座身份、权限、知识库和事件通信。" />
      <div className="terminal-grid">
        {terminals.map((item) => (
          <article className="terminal-card" key={item.id}>
            <div><strong>{item.name}</strong><Status status={item.status} /></div>
            <p>{item.stack}</p>
            <ul>{item.scope.map((scope) => <li key={scope}>{scope}</li>)}</ul>
          </article>
        ))}
      </div>
      <section className="panel">
        <h2>企微授权与多端登录链路</h2>
        <div className="flow-list">
          {wecom?.authFlow?.map((step, index) => <div key={step}><span>{index + 1}</span>{step}</div>)}
        </div>
        <div className="two-column">
          <Card title="线上风险" text={wecom?.risks?.join(' / ') || ''} />
          <Card title="解决策略" text={wecom?.mitigations?.join(' / ') || ''} />
        </div>
      </section>
    </section>
  );
}
