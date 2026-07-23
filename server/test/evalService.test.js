import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreRunQuality } from '../src/services/evalService.js';

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
