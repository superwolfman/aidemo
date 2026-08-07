import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDeliveryArtifacts, buildFallbackAnswer } from '../src/services/toolExecutor.js';

const sources = [
  {
    documentTitle: 'AI 产品工作流规范',
    content: '需求输入后需要生成 PRD、页面结构、API Contract、任务拆解和风险确认。',
    score: 0.91,
    retrievalBackend: 'mongodb-atlas-vector-search'
  }
];

test('buildDeliveryArtifacts creates traceable delivery assets', async () => {
  const artifacts = await buildDeliveryArtifacts({
    intent: {
      id: 'product-delivery-agent',
      label: 'AI 产品交付工作流',
      goal: '把需求转成 PRD、页面结构、API Contract、研发任务和测试策略。',
      riskLevel: 'high'
    },
    prompt: '建设一个 AI 产品工作流',
    sources
  });

  assert.equal(artifacts.length, 5);
  assert.deepEqual(artifacts.map((artifact) => artifact.type), ['prd', 'flow', 'api', 'task', 'risk']);
  assert.match(artifacts[0].content, /AI 产品工作流规范/);
});

test('buildFallbackAnswer exposes live vector retrieval state', () => {
  const answer = buildFallbackAnswer({
    intent: {
      id: 'product-delivery-agent',
      label: 'AI 产品交付工作流',
      goal: '把需求转成交付物。'
    },
    sources,
    artifacts: [{ type: 'prd', title: 'PRD 摘要' }]
  });

  assert.match(answer, /mongodb-atlas-vector-search/);
  assert.match(answer, /PRD 摘要/);
});
