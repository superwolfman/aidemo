import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEvalCases, scoreRunQuality } from '../src/services/evalService.js';

test('eval service scores real vector, citations, artifacts and trace as reviewable', () => {
  const quality = scoreRunQuality({
    provider: { provider: 'deepseek', mode: 'live' },
    intent: { riskLevel: 'high' },
    sources: [
      { score: 0.72, retrievalBackend: 'mongodb-atlas-vector-search' },
      { score: 0.68, retrievalBackend: 'mongodb-atlas-vector-search' }
    ],
    artifacts: [
      { type: 'prd', content: `# PRD\n\n## 产品目标\n${'覆盖目标。'.repeat(80)}\n\n## 核心用户\n产品、研发、测试。` },
      { type: 'api', content: '{"request":{},"response":{}}' },
      { type: 'flow', content: '{}' },
      { type: 'task', content: '# tasks' },
      { type: 'risk', content: '# risk' }
    ],
    trace: [
      { id: 'intent', name: '意图理解', status: 'success' },
      { id: 'skill', name: 'Skill 选择', status: 'success' },
      { id: 'rag', name: 'RAG 检索', status: 'success' },
      { id: 'tool', name: 'Tool', status: 'success' },
      { id: 'llm', name: 'LLM', status: 'success' },
      { id: 'review', name: '人工确认', status: 'waiting' }
    ]
  });

  assert.equal(quality.usesRealVector, true);
  assert.equal(quality.providerLive, true);
  assert.equal(quality.checks.find((item) => item.key === 'trace')?.passed, true);
  assert.ok(quality.score >= 80);
});

test('KERING 案例默认 hidden，filter 后不出现在面板', () => {
  const kering = buildEvalCases().find((c) => c.id === 'kering-greater-china-retail-copilot');
  assert.ok(kering, 'KERING 案例配置必须存在（仅视觉隐藏）');
  assert.equal(kering.hidden, true);

  // agentStudio 路由的过滤逻辑：!item.hidden
  const visible = buildEvalCases().filter((c) => !c.hidden);
  const ids = visible.map((c) => c.id);
  assert.ok(!ids.includes('kering-greater-china-retail-copilot'), 'KERING 必须不出现在面板');
  // SGS 仍然可见
  assert.ok(ids.includes('sgs-frontend-ai-delivery-copilot'));
  assert.ok(visible.length >= 4);
});
