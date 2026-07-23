import assert from 'node:assert/strict';
import test from 'node:test';
import { agentCapabilities, getAgentCapability } from '../src/services/skillRegistry.js';

test('skill registry exposes agent capabilities and fallback selection', () => {
  assert.ok(agentCapabilities.length >= 3);
  assert.equal(getAgentCapability({ id: 'delivery-review-agent' }).name, '交付评审 Agent');
  assert.equal(getAgentCapability({ id: 'unknown' }).id, agentCapabilities[0].id);
});
