import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilitiesForRole } from '../src/security/capabilities.js';

test('demo viewer receives explicit restricted capabilities', () => {
    const capabilities = capabilitiesForRole('demo_viewer');
    assert.equal(capabilities.mode, 'restricted-demo');
    assert.equal(capabilities.canCreateRun, true);
    assert.equal(capabilities.canEditArtifacts, false);
    assert.equal(capabilities.canReviewArtifacts, false);
    assert.equal(capabilities.canExportArtifacts, false);
    assert.equal(capabilities.canScoreEval, false);
    assert.equal(capabilities.canSwitchTenant, false);
    assert.equal(capabilities.canControlRuns, false);
    assert.equal(capabilities.canReplayRuns, false);
    assert.equal(capabilities.canReviewRuns, false);
});

test('standard roles retain existing product capabilities', () => {
    const capabilities = capabilitiesForRole('admin');
    assert.equal(capabilities.mode, 'standard');
    assert.equal(capabilities.canEditArtifacts, true);
    assert.equal(capabilities.canReviewArtifacts, true);
    assert.equal(capabilities.canControlRuns, true);
    assert.equal(capabilities.canReplayRuns, true);
    assert.equal(capabilities.canReviewRuns, true);
});
