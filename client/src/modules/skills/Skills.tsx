import React, { useEffect, useState } from 'react';
import { request, streamRequest } from '../../api/client';
import { Header } from '../../components/ui';
import { AppEvents } from '../../platform/events';

export default function Skills({ shell }) {
  const [skills, setSkills] = useState([]);
  const [active, setActive] = useState(null);
  const [output, setOutput] = useState('');

  useEffect(() => {
    request('/api/enablement/skills').then((res) => {
      setSkills(res.skills);
      setActive(res.skills[0]);
    });
  }, []);

  async function run(skill) {
    setActive(skill);
    setOutput('');
    await streamRequest(`/api/enablement/skills/${skill.id}/run/stream`, { text: '客户准备了解企业数字化展业方案' }, {
      step: (data) => setOutput((prev) => `${prev}\n[${data.status}] ${data.title}`),
      delta: (data) => setOutput((prev) => prev + data.text)
    });
    shell.eventBus.emit(AppEvents.SKILL_RUN_COMPLETED, { skillId: skill.id });
  }

  return (
    <section>
      <Header title="AI Skill 自定义、编排与复用" desc="Skill 以输入输出 Schema、工具链、权限和审计为核心，支撑企微问答、客户简报、AI 辅助标注。" />
      <div className="two-column">
        <section className="panel">
          <h2>Skill Registry</h2>
          <div className="list">
            {skills.map((skill) => (
              <button className={`list-item ${active?.id === skill.id ? 'selected' : ''}`} key={skill.id} onClick={() => run(skill)}>
                <strong>{skill.name}</strong>
                <span>{skill.tools.join(' -> ')}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="panel"><h2>执行结果</h2><pre className="stream-box tall">{output || '选择一个 Skill 执行...'}</pre></section>
      </div>
    </section>
  );
}
