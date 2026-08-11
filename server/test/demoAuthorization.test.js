import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateDemoPermission } from '../src/middleware/demoAuthorization.js';
import { SlidingWindowLimiter } from '../src/security/requestLimiter.js';

test('demo_viewer can start bounded demo runs but cannot mutate knowledge or approvals', () => {
    assert.equal(evaluateDemoPermission({
        role: 'demo_viewer',
        area: 'copilot',
        method: 'POST',
        path: '/sessions/session-1/messages/stream'
    }).allowed, true);

    assert.equal(evaluateDemoPermission({
        role: 'demo_viewer',
        area: 'copilot',
        method: 'POST',
        path: '/knowledge/upload'
    }).code, 'DEMO_READ_ONLY');

    assert.equal(evaluateDemoPermission({
        role: 'demo_viewer',
        area: 'copilot',
        method: 'POST',
        path: '/approvals/approval-1/confirm'
    }).allowed, false);

    assert.equal(evaluateDemoPermission({
        role: 'demo_viewer',
        area: 'agentStudio',
        method: 'POST',
        path: '/eval-cases/ai-product-workflow/score'
    }).allowed, false);
});

test('regular members keep existing route permissions', () => {
    assert.equal(evaluateDemoPermission({
        role: 'member',
        area: 'copilot',
        method: 'POST',
        path: '/knowledge/upload'
    }).allowed, true);
});

test('sliding window quota rejects excess runs and reopens after the window', () => {
    const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 1000 });
    assert.equal(limiter.consume('viewer', 1000).allowed, true);
    assert.equal(limiter.consume('viewer', 1500).allowed, true);
    assert.equal(limiter.consume('viewer', 1600).allowed, false);
    assert.equal(limiter.consume('viewer', 2101).allowed, true);
});
