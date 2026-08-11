import assert from 'node:assert/strict';
import test from 'node:test';
import {
    SessionSecurityError,
    parseCookieHeader,
    validateUserAccount,
    validateUserSession
} from '../src/security/session.js';

function user (patch = {}) {
    return {
        _id: 'user-1',
        email: 'viewer@example.com',
        tenantId: 'tenant-interview-demo',
        tenants: [{ tenantId: 'tenant-interview-demo', role: 'demo_viewer' }],
        activeTenantId: 'tenant-interview-demo',
        role: 'demo_viewer',
        tokenVersion: 2,
        ...patch
    };
}

test('session validation accepts the current token version and assigned tenant', () => {
    assert.equal(validateUserSession(user(), { ver: 2, tid: 'tenant-interview-demo' })._id, 'user-1');
});

test('incrementing tokenVersion revokes an already issued session', () => {
    assert.throws(
        () => validateUserSession(user(), { ver: 1, tid: 'tenant-interview-demo' }),
        (error) => error instanceof SessionSecurityError && error.code === 'SESSION_REVOKED'
    );
});

test('disabled and expired demo users cannot authenticate', () => {
    assert.throws(
        () => validateUserAccount(user({ disabledAt: '2026-08-11T00:00:00.000Z' })),
        (error) => error.code === 'USER_DISABLED'
    );
    assert.throws(
        () => validateUserAccount(user({ demoExpiresAt: '2026-08-10T00:00:00.000Z' }), Date.parse('2026-08-11T00:00:00.000Z')),
        (error) => error.code === 'DEMO_ACCESS_EXPIRED'
    );
});

test('cookie parser keeps encoded values and ignores malformed parts', () => {
    assert.deepEqual(parseCookieHeader('one=a%20b; malformed; session=abc.def'), {
        one: 'a b',
        session: 'abc.def'
    });
});
