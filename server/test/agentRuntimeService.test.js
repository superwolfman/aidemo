import assert from 'node:assert/strict';
import test from 'node:test';
import { transitionRunPatch } from '../src/services/agentRuntimeService.js';

test('agent runtime allows valid status transition and records audit transition', () => {
  const patch = transitionRunPatch(
    { status: 'created', stateTransitions: [] },
    'intent_detected',
    { actorId: 'tester', label: 'detect intent' }
  );

  assert.equal(patch.status, 'intent_detected');
  assert.equal(patch.stateTransitions.length, 1);
  assert.equal(patch.stateTransitions[0].from, 'created');
  assert.equal(patch.stateTransitions[0].to, 'intent_detected');
});

test('agent runtime rejects invalid status transition', () => {
  assert.throws(
    () => transitionRunPatch({ status: 'confirmed' }, 'failed'),
    /Invalid Agent Run transition/
  );
});
