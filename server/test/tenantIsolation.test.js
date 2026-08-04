import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AuthorizationError,
    allowedScopesForListing,
    authorizeKnowledgeScopes,
    createTenantContext,
    isKnowledgeRecordVisible,
    requireTenantContext
} from '../src/security/tenantContext.js';
import { buildTenantVectorPipeline } from '../src/store/mongoStore.js';
import { retrieveKnowledge } from '../src/services/ragEngine.js';

function context (tenantId, allowedKnowledgeScopes = ['architecture']) {
    return createTenantContext({
        _id: `user-${tenantId}`,
        tenantId,
        role: 'member',
        allowedKnowledgeScopes
    });
}

test('tenant context is mandatory for knowledge access', () => {
    assert.throws(
        () => requireTenantContext(null),
        (error) => error instanceof AuthorizationError && error.code === 'TENANT_CONTEXT_REQUIRED'
    );
});

test('requested scopes cannot exceed authenticated membership', () => {
    const alpha = context('tenant-alpha', ['architecture']);
    assert.deepEqual(authorizeKnowledgeScopes(alpha, ['architecture']), ['architecture']);
    assert.throws(
        () => authorizeKnowledgeScopes(alpha, ['finance']),
        (error) => error instanceof AuthorizationError && error.code === 'KNOWLEDGE_SCOPE_FORBIDDEN'
    );
});

test('record visibility requires both tenant and scope match', () => {
    const alpha = context('tenant-alpha', ['architecture']);
    const scopes = authorizeKnowledgeScopes(alpha, ['architecture']);

    assert.equal(isKnowledgeRecordVisible(alpha, {
        tenantId: 'tenant-alpha',
        scopes: ['architecture']
    }, scopes), true);

    assert.equal(isKnowledgeRecordVisible(alpha, {
        tenantId: 'tenant-beta',
        scopes: ['architecture']
    }, scopes), false);

    assert.equal(isKnowledgeRecordVisible(alpha, {
        tenantId: 'tenant-alpha',
        scopes: ['finance']
    }, scopes), false);
});

test('list visibility is restricted for non-wildcard members', () => {
    assert.deepEqual(allowedScopesForListing(context('tenant-alpha', ['architecture'])), ['architecture']);
    assert.equal(allowedScopesForListing(context('tenant-alpha', ['*'])), null);
});

test('Atlas vector query applies tenant and scope before vector retrieval', () => {
    const alpha = context('tenant-alpha', ['architecture']);
    const pipeline = buildTenantVectorPipeline({
        context: alpha,
        scopes: ['architecture'],
        queryEmbedding: [0.1, 0.2],
        limit: 5,
        numCandidates: 80
    });

    assert.deepEqual(pipeline[0].$vectorSearch.filter, {
        $and: [
            { tenantId: { $eq: 'tenant-alpha' } },
            { scopes: { $in: ['architecture'] } }
        ]
    });
    assert.equal(pipeline[0].$vectorSearch.limit, 5);
});

test('zero authorized hits returns an empty list without an unfiltered retry', async () => {
    const alpha = context('tenant-alpha', ['architecture']);
    let calls = 0;
    const store = {
        kind: 'mongo',
        async searchVectorChunks (receivedContext, query, options) {
            calls += 1;
            assert.equal(receivedContext.tenantId, 'tenant-alpha');
            assert.deepEqual(options.scopes, ['architecture']);
            return [];
        },
        async searchChunks (receivedContext, query, options) {
            calls += 1;
            assert.equal(receivedContext.tenantId, 'tenant-alpha');
            assert.deepEqual(options.scopes, ['architecture']);
            return [];
        }
    };

    const result = await retrieveKnowledge({
        store,
        context: alpha,
        query: 'no matching content',
        scopes: ['architecture'],
        limit: 5
    });

    assert.equal(calls, 1);
    assert.deepEqual(result.sources, []);
    assert.deepEqual(result.filteredChunks, []);
    assert.deepEqual(result.filter, { tenantApplied: true, scopeApplied: true });
});
