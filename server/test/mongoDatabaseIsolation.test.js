import assert from 'node:assert/strict';
import test from 'node:test';
import {
    defaultMongoDatabaseName,
    mongoUsernameFromUri,
    runtimeDatabaseEnvironment,
    validateMongoCredentialIsolation,
    validateMongoDatabaseIsolation,
    validateMongoRuntimeRoles
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

test('production and development require environment-specific application identities', () => {
    assert.equal(
        mongoUsernameFromUri('mongodb+srv://aidemo_prod_app:secret@example.mongodb.net/'),
        'aidemo_prod_app'
    );
    assert.deepEqual(validateMongoCredentialIsolation({
        nodeEnv: 'production',
        uri: 'mongodb+srv://aidemo_prod_app:secret@example.mongodb.net/',
        expectedUsername: 'aidemo_prod_app',
        explicit: true
    }).errors, []);
    assert.ok(validateMongoCredentialIsolation({
        nodeEnv: 'production',
        uri: 'mongodb+srv://aidemo_dev_app:secret@example.mongodb.net/',
        expectedUsername: 'aidemo_dev_app',
        explicit: true
    }).errors.some((message) => message.includes('_prod_app')));
    assert.ok(validateMongoCredentialIsolation({
        nodeEnv: 'production',
        uri: 'mongodb+srv://aidemo_prod_app:secret@example.mongodb.net/',
        expectedUsername: '',
        explicit: false
    }).errors.some((message) => message.includes('explicitly configured')));
});

test('production runtime rejects admin identities and cross-database roles', () => {
    assert.deepEqual(validateMongoRuntimeRoles({
        databaseName: 'aidemo_prod',
        roles: [{ role: 'readWrite', db: 'aidemo_prod' }]
    }), []);
    assert.ok(validateMongoRuntimeRoles({
        databaseName: 'aidemo_prod',
        roles: [{ role: 'atlasAdmin', db: 'admin' }]
    }).some((message) => message.includes('administrative')));
    assert.ok(validateMongoRuntimeRoles({
        databaseName: 'aidemo_prod',
        roles: [
            { role: 'readWrite', db: 'aidemo_prod' },
            { role: 'readWrite', db: 'aidemo_dev' }
        ]
    }).some((message) => message.includes('outside')));
});
