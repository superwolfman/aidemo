import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAccessUser } from '../src/routes/auth.js';

function createMemoryStore () {
    const users = [];
    return {
        users,
        async findUserByEmail (email) {
            return users.find((user) => user.email === email) || null;
        },
        async createRecord (collection, payload) {
            assert.equal(collection, 'users');
            const created = { _id: `user-${users.length + 1}`, ...payload };
            users.push(created);
            return created;
        },
        async updateRecord (collection, id, patch) {
            assert.equal(collection, 'users');
            const user = users.find((entry) => entry._id === id);
            Object.assign(user, patch);
            return user;
        }
    };
}

test('verified Access identity is provisioned into the existing users data model', async () => {
    const store = createMemoryStore();
    const options = {
        autoProvision: true,
        tenantId: 'tenant-interview-demo',
        allowedKnowledgeScopes: ['architecture', 'frontend'],
        accessExpiresAt: '2099-08-12T12:00:00.000Z'
    };
    const first = await resolveAccessUser(store, {
        sub: 'cf-user-1',
        email: 'interviewer@example.com',
        name: 'Interviewer'
    }, options);

    assert.equal(first.role, 'demo_viewer');
    assert.equal(first.tenantId, 'tenant-interview-demo');
    assert.deepEqual(first.allowedKnowledgeScopes, ['architecture', 'frontend']);
    assert.equal(first.authProvider, 'cloudflare-access');
    assert.equal(first.tokenVersion, 0);
    assert.equal(store.users.length, 1);

    const second = await resolveAccessUser(store, {
        sub: 'cf-user-1',
        email: 'interviewer@example.com',
        name: 'Interviewer'
    }, options);
    assert.equal(second._id, first._id);
    assert.equal(store.users.length, 1);
    assert.ok(second.lastAccessLoginAt);
});

test('unknown Access identity is denied when automatic provisioning is disabled', async () => {
    const store = createMemoryStore();
    await assert.rejects(
        resolveAccessUser(store, {
            sub: 'cf-user-2',
            email: 'unknown@example.com'
        }, { autoProvision: false }),
        (error) => error.code === 'DEMO_USER_NOT_PROVISIONED' && error.statusCode === 403
    );
    assert.equal(store.users.length, 0);
});
