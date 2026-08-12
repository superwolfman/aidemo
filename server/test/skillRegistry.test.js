import assert from 'node:assert/strict';
import test from 'node:test';
import { agentCapabilities, buildRunExecutionContext, getAgentCapability, getAgentTaskMode } from '../src/services/skillRegistry.js';

test('skill registry exposes agent capabilities and fallback selection', () => {
  assert.ok(agentCapabilities.length >= 3);
  assert.equal(getAgentCapability({ id: 'delivery-review-agent' }).name, '交付评审 Agent');
  assert.equal(getAgentCapability({ id: 'unknown' }).id, agentCapabilities[0].id);
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
