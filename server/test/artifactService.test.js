import assert from 'node:assert/strict';
import test from 'node:test';
import { attachArtifactWorkflow } from '../src/services/artifactService.js';

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
