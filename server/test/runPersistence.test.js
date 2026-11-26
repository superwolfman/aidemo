import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createRunPersistenceError,
    isTransientMongoConnectionError,
    retryTransientMongoOperation
} from '../src/services/runPersistence.js';

test('retries one transient Mongo timeout and returns the successful result', async () => {
    let calls = 0;
    const result = await retryTransientMongoOperation(async () => {
        calls += 1;
        if (calls === 1) {
            const error = new Error('connection 4 to 198.18.0.60:27017 timed out');
            error.name = 'MongoNetworkTimeoutError';
            throw error;
        }
        return 'persisted';
    }, { sleep: async () => {} });

    assert.equal(result, 'persisted');
    assert.equal(calls, 2);
});

test('does not retry a non-network persistence failure', async () => {
    let calls = 0;
    await assert.rejects(
        retryTransientMongoOperation(async () => {
            calls += 1;
            throw new Error('document validation failed');
        }, { sleep: async () => {} }),
        /document validation failed/
    );
    assert.equal(calls, 1);
});

test('classifies proxy Fake-IP timeout and wraps it as persistence failure', () => {
    const timeout = new Error('connection 4 to 198.18.0.60:27017 timed out');
    assert.equal(isTransientMongoConnectionError(timeout), true);

    const wrapped = createRunPersistenceError(timeout);
    assert.equal(wrapped.code, 'RUN_PERSISTENCE_FAILED');
    assert.equal(wrapped.stage, 'persistence');
    assert.equal(wrapped.statusCode, 503);
    assert.match(wrapped.message, /运行状态持久化失败/);
});
