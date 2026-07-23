import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRunControlPatch, createReplayRunDraft, transitionRunPatch } from '../src/services/agentRuntimeService.js';

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

test('agent runtime builds auditable control patch', () => {
  const control = buildRunControlPatch(
    { status: 'review_required', stateTransitions: [], artifacts: [] },
    { action: 'pause', actorId: 'tester', reason: 'manual checkpoint' }
  );

  assert.equal(control.status, 'paused');
  assert.equal(control.patch.controlHistory[0].action, 'pause');
  assert.equal(control.log.level, 'control');
});

test('agent runtime creates replay run draft from failed run', () => {
  const replay = createReplayRunDraft(
    { _id: 'run-1', runId: 'run-1', status: 'failed', prompt: 'build agent', logs: [{ id: 'old' }] },
    { actorId: 'tester', reason: 'provider failed' }
  );

  assert.equal(replay.status, 'created');
  assert.equal(replay.replayOf, 'run-1');
  assert.equal(replay.prompt, 'build agent');
  assert.equal(replay.logs[0].level, 'replay');
  assert.equal(replay.stateTransitions[0].label, '失败回放');
});
