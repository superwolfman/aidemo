import assert from 'node:assert/strict';
import test from 'node:test';
import { enforceDemoPermissions, evaluateDemoPermission } from '../src/middleware/demoAuthorization.js';
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

test('denied demo mutations are audited without storing request bodies or tokens', async () => {
    const events = [];
    const store = { createTelemetry: async (event) => events.push(event) };
    const req = {
        method: 'PATCH',
        path: '/runs/run-1/artifacts/artifact-1',
        originalUrl: '/api/agent-studio/runs/run-1/artifacts/artifact-1?secret=ignored',
        ip: '192.0.2.10',
        headers: {
            authorization: 'Bearer must-not-be-audited',
            'user-agent': 'authorization-test'
        },
        body: { content: 'must-not-be-audited' },
        user: { _id: 'viewer-1', email: 'viewer@example.invalid' },
        auth: { actorId: 'viewer-1', tenantId: 'tenant-demo', role: 'demo_viewer' }
    };
    const response = {
        statusCode: 200,
        status (code) { this.statusCode = code; return this; },
        json (value) { this.body = value; return this; }
    };
    let nextCalled = false;
    await enforceDemoPermissions(store, 'agentStudio')(req, response, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(response.statusCode, 403);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'security.authorization.denied');
    assert.equal(events[0].path, '/api/agent-studio/runs/run-1/artifacts/artifact-1');
    assert.equal(events[0].code, 'DEMO_READ_ONLY');
    assert.equal('body' in events[0], false);
    assert.equal('authorization' in events[0], false);
});
