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

test('delivery review artifacts use the generated report heading and review-specific titles', async () => {
  const artifacts = await buildDeliveryArtifacts({
    intent: { id: 'delivery-review-agent', label: '交付质量评审', goal: '评审交付质量', riskLevel: 'high' },
    prompt: '投研报告生成工作台',
    sources: [],
    taskModeId: 'delivery-review'
  });

  assert.ok(!artifacts[0].title.includes('知识库问答'));
  assert.equal(artifacts[1].title, '测试策略与验收路径');
  assert.equal(artifacts[4].title, '风险与人工审批建议');
});
