import React, { useEffect, useState } from 'react';
import { Bot, Database, Map, MonitorDot, Radio, ShieldCheck, Smartphone, Sparkles, Workflow } from 'lucide-react';
import { request } from '../../api/client';
import { Card, Header, Metric } from '../../components/ui';
import { realtime } from '../../platform/realtime';

export default function Overview({ shell }) {
  const [data, setData] = useState(null);
  const [live, setLive] = useState<any>(null);

  useEffect(() => {
    request('/api/enablement/overview').then(setData).catch(console.error);
    realtime.subscribe('overview');
    return realtime.on('overview:update', setLive);
  }, []);

  const metrics = { ...(data?.metrics || {}), ...(live || {}) };

  return (
    <section>
      <Header
        title="员工展业 AI 中台"
        desc="微前端基座承载 PC、H5、企微内嵌、RAG、AI Skill、低码流程编辑器和运维监控等子应用。"
      />
      <div className="hero-panel">
        <div>
          <span className="eyebrow">Micro Frontend Shell + AI Enablement</span>
          <h2>从单体工作台升级为可治理的员工展业平台</h2>
          <p>基座统一登录态、菜单、路由、事件通信和子应用生命周期。每个业务域都是独立子应用，可独立演进、灰度和观测。</p>
        </div>
        <div className="hero-grid">
          {data?.architecture?.map((item) => <div key={item}>{item}</div>)}
          <div>Global EventBus: route / auth / skill / flow / telemetry</div>
        </div>
      </div>
      <div className="metric-grid">
        <Metric icon={Smartphone} label="展业终端" value={metrics.terminals || 0} />
        <Metric icon={Database} label="知识文档" value={metrics.knowledgeDocs || 0} />
        <Metric icon={Bot} label="活跃会话" value={metrics.activeSessions || 0} />
        <Metric icon={Sparkles} label="Skill 执行" value={metrics.skillRuns || 0} />
        <Metric icon={Radio} label="WS 延迟" value={`${metrics.wsLatency || '-'}ms`} />
        <Metric icon={Workflow} label="队列深度" value={metrics.queueDepth || 0} />
        <Metric icon={ShieldCheck} label="幻觉率" value={metrics.hallucinationRate || '-'} />
        <Metric icon={MonitorDot} label="MTTR" value={metrics.mttr || '-'} />
        <Metric icon={Map} label="标注效率" value={metrics.labelingEfficiency || '-'} />
      </div>
      <section className="panel">
        <h2>子应用边界</h2>
        <div className="capability-grid">
          <Card title="三端展业" text="PC/H5/企微统一身份、权限、Bridge 和终端状态。" />
          <Card title="企微 AI 助手" text="SSE、会话记忆、RAG 引用、防幻觉、转人工。" />
          <Card title="Spec Coding" text="规格驱动 API、状态机、数据库、灰度和运维清单。" />
          <Card title="AI Skill" text="输入输出 Schema、工具权限、执行审计和复用规范。" />
          <Card title="低码流程编辑器" text="Document Model、Plugin、Selection、History、Command、Worker 布局。" />
          <Card title="发布运维" text="多端静态资源、容器化、灰度、Trace 和复盘。" />
        </div>
      </section>
      <section className="panel">
        <div className="section-head">
          <h2>实时通道</h2>
          <button className="secondary-button" onClick={() => shell.navigate('im')}>打开在线 IM</button>
        </div>
        <div className="realtime-grid">
          <Card title="WebSocket 通道" text="平台总览订阅 /ws overview:update，实时展示在线员工、队列、延迟和业务信号。" />
          <Card title="增长信号" text={`实时转化信号 ${metrics.conversionSignal || '-'}%，用于驱动运营 Agent 和坐席提醒。`} />
          <Card title="最近遥测" text={(metrics.lastTelemetry || []).map((item) => item.type).join(' / ') || '等待实时事件'} />
        </div>
      </section>
    </section>
  );
}
