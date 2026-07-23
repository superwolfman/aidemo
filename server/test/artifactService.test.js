import assert from 'node:assert/strict';
import test from 'node:test';
import { applyArtifactReview, attachArtifactWorkflow } from '../src/services/artifactService.js';

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
