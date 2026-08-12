import assert from 'node:assert/strict';
import test from 'node:test';
import { agentCapabilities, buildRunExecutionContext, getAgentCapability, getAgentTaskMode, resolveTaskModeIntent } from '../src/services/skillRegistry.js';

test('skill registry exposes agent capabilities and fallback selection', () => {
  assert.ok(agentCapabilities.length >= 3);
  assert.equal(getAgentCapability({ id: 'delivery-review-agent' }).name, '交付评审 Agent');
  assert.equal(getAgentCapability({ id: 'unknown' }).id, agentCapabilities[0].id);
});

test('explicit task mode overrides keyword intent while preserving its audit signals', () => {
  const intent = resolveTaskModeIntent({
    id: 'knowledge-assistant',
    label: '知识库问答与运营纠错',
    scopes: ['standards'],
    signals: ['knowledge']
  }, { taskModeId: 'delivery-review' });

  assert.equal(intent.id, 'delivery-review-agent');
  assert.equal(intent.label, '交付质量评审');
  assert.deepEqual(intent.scopes, ['standards']);
  assert.ok(intent.signals.includes('task_mode:delivery-review'));
});

test('task mode and execution agent are represented independently', () => {
  const mode = getAgentTaskMode('requirement-analysis');
  const agent = getAgentCapability({ id: 'product-delivery-agent' });
  const context = buildRunExecutionContext({
    source: 'delivery-copilot',
    taskModeId: mode.id,
    agentId: agent.id
  }, agent);

  assert.equal(mode.label, '架构级需求分析');
  assert.equal(context.taskMode.id, 'requirement-analysis');
  assert.equal(context.resolvedAgentId, 'product-delivery-agent');
  assert.equal(context.requestedSkillId, null);
});
