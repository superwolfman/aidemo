import assert from 'node:assert/strict';
import test from 'node:test';
import { applyArtifactReview, attachArtifactWorkflow, exportArtifact } from '../src/services/artifactService.js';

test('artifact service attaches version, review state and trace/source refs', () => {
  const [artifact] = attachArtifactWorkflow(
    [{ id: 'a1', type: 'prd', title: 'PRD', content: '# PRD' }],
    'tool',
    [{ _id: 's1', documentTitle: 'Spec', score: 0.82, retrievalBackend: 'mongodb-atlas-vector-search' }]
  );

  assert.equal(artifact.status, 'draft');
  assert.equal(artifact.version, 1);
  assert.equal(artifact.traceStepId, 'tool');
  assert.equal(artifact.sourceRefs[0].id, 's1');
  assert.equal(artifact.versions.length, 1);
  assert.deepEqual(artifact.approvals, []);
});

test('artifact service applies review state flow with approval history', () => {
  const [artifact] = attachArtifactWorkflow(
    [{ id: 'a1', type: 'prd', title: 'PRD', content: '# PRD' }],
    'tool',
    []
  );
  const reviewed = applyArtifactReview(artifact, {
    action: 'confirm',
    note: 'ready for delivery',
    operatorId: 'tester'
  });

  assert.equal(reviewed.status, 'confirmed');
  assert.equal(reviewed.reviewStatus, 'confirmed');
  assert.equal(reviewed.approvals.length, 1);
  assert.equal(reviewed.approvals[0].note, 'ready for delivery');
});

test('artifact confirm is idempotent after confirmation', () => {
  const [artifact] = attachArtifactWorkflow(
    [{ id: 'a1', type: 'prd', title: 'PRD', content: '# PRD' }],
    'tool',
    []
  );
  const confirmed = applyArtifactReview(artifact, { action: 'confirm', operatorId: 'tester' });
  const retried = applyArtifactReview(confirmed, { action: 'confirm', operatorId: 'tester' });

  assert.equal(retried, confirmed);
  assert.equal(retried.approvals.length, 1);
});

test('artifact export preserves tenant context on reads and writes', async () => {
  const context = { tenantId: 'tenant-a', actorId: 'user-a', role: 'member' };
  const run = {
    _id: 'run-a',
    artifacts: [{ id: 'a1', type: 'prd', title: 'PRD', content: '# PRD', status: 'draft' }],
    logs: []
  };
  const calls = [];
  const store = {
    async getRecord(collection, id, receivedContext) {
      calls.push(['get', collection, id, receivedContext]);
      return run;
    },
    async updateRecord(collection, id, patch, receivedContext) {
      calls.push(['update', collection, id, receivedContext]);
      return { ...run, ...patch };
    }
  };

  await exportArtifact(store, 'run-a', 'a1', { actorId: 'user-a', context });

  assert.equal(calls.length, 2);
  assert.equal(calls[0][3], context);
  assert.equal(calls[1][3], context);
});
