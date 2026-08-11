import assert from 'node:assert/strict';
import test from 'node:test';
import {
    defaultMongoDatabaseName,
    runtimeDatabaseEnvironment,
    validateMongoDatabaseIsolation
} from '../src/store/mongoDatabase.js';

test('database names are isolated by runtime environment', () => {
    assert.equal(defaultMongoDatabaseName('development'), 'aidemo_dev');
    assert.equal(defaultMongoDatabaseName('test'), 'aidemo_test');
    assert.equal(defaultMongoDatabaseName('production'), 'aidemo_prod');
    assert.equal(runtimeDatabaseEnvironment('staging'), 'development');
});

test('production requires an explicit prod database', () => {
    assert.deepEqual(validateMongoDatabaseIsolation({
        nodeEnv: 'production',
        databaseName: 'aidemo_prod',
        explicit: true
    }).errors, []);
    assert.ok(validateMongoDatabaseIsolation({
        nodeEnv: 'production',
        databaseName: 'aidemo_dev',
        explicit: true
    }).errors.some((message) => message.includes('_prod')));
    assert.ok(validateMongoDatabaseIsolation({
        nodeEnv: 'production',
        databaseName: 'aidemo_prod',
        explicit: false
    }).errors.some((message) => message.includes('explicitly configured')));
});

test('development and test cannot target production or reserved databases', () => {
    assert.ok(validateMongoDatabaseIsolation({
        nodeEnv: 'development',
        databaseName: 'aidemo_prod',
        explicit: true
    }).errors.length > 0);
    assert.ok(validateMongoDatabaseIsolation({
        nodeEnv: 'test',
        databaseName: 'admin',
        explicit: true
    }).errors.length > 0);
});
