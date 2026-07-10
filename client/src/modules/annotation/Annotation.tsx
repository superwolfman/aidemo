import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { request } from '../../api/client';
import { Header, Status } from '../../components/ui';

export default function Annotation() {
  const [tasks, setTasks] = useState([]);
  const [viz, setViz] = useState(null);

  async function load() {
    const [taskRes, vizRes] = await Promise.all([
      request('/api/enablement/annotation/tasks'),
      request('/api/enablement/visualization')
    ]);
    setTasks(taskRes.tasks);
    setViz(vizRes);
  }

  useEffect(() => { load().catch(console.error); }, []);

  async function prelabel(task) {
    await request(`/api/enablement/annotation/tasks/${task._id}/prelabel`, { method: 'POST', body: JSON.stringify({}) });
    await load();
  }

  return (
    <section>
      <Header title="AI 辅助标注工作台" desc="任务分配、审核流程、供应商质量、模型预标注、人机协同和地图轨迹回放。" />
      <div className="two-column">
        <section className="panel">
          <h2>标注任务</h2>
          <div className="list">
            {tasks.map((task) => (
              <article className="annotation-item" key={task._id}>
                <div><strong>{task.title}</strong><Status status={task.status} /></div>
                <p>{task.vendor} · 进度 {task.progress}% · 质量 {task.quality}</p>
                <p>{task.aiSuggestion}</p>
                <button className="secondary-button" onClick={() => prelabel(task)}><Sparkles size={16} />AI 预标注</button>
              </article>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2>质量统计与轨迹回放</h2>
          <div className="bar-chart">
            {viz?.quality?.map((item) => <div key={item.name}><span>{item.name}</span><strong style={{ width: `${item.value}%` }}>{item.value}</strong></div>)}
          </div>
          <svg className="map-view" viewBox="0 0 100 80">
            <polyline points={viz?.trajectory?.map((p) => p.join(',')).join(' ')} fill="none" stroke="#0f766e" strokeWidth="3" />
            {viz?.trajectory?.map((p, index) => <circle key={index} cx={p[0]} cy={p[1]} r="2.4" fill="#0f766e" />)}
          </svg>
        </section>
      </div>
    </section>
  );
}
