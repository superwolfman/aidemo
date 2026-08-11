import assert from 'node:assert/strict';
import test from 'node:test';
import { validateConfig } from '../src/config/validateConfig.js';

function productionConfig (patch = {}) {
    return {
        nodeEnv: 'production',
        jwtSecret: 'a-secure-production-secret',
        mongodbUri: 'mongodb+srv://aidemo_prod_app:secret@example.mongodb.net/',
        mongodbDatabase: 'aidemo_prod',
        mongodbDatabaseExplicit: true,
        mongodbExpectedUsername: 'aidemo_prod_app',
        mongodbExpectedUsernameExplicit: true,
        llmProvider: 'mock',
        llmApiKey: '',
        allowFileStoreFallback: false,
        cloudflareAccessEnabled: false,
        passwordLoginEnabled: true,
        legacyBearerEnabled: false,
        seedDemoAdmin: false,
        sessionCookieSecure: true,
        sessionCookieName: '__Host-aidemo_session',
        clientOrigin: 'https://demo.example.com',
        sessionTtlSeconds: 1800,
        demoRunLimitPerHour: 20,
        loginAttemptLimit: 5,
        loginAttemptWindowMs: 900000,
        demoAccessExpiresAt: '',
        port: 4000,
        ...patch
    };
}

test('production accepts HTTPS, Secure Cookie and a scoped environment identity', () => {
    assert.doesNotThrow(() => validateConfig(productionConfig()));
});

test('production rejects insecure origins and cookies', () => {
    assert.throws(
        () => validateConfig(productionConfig({ sessionCookieSecure: false })),
        /SESSION_COOKIE_SECURE/
    );
    assert.throws(
        () => validateConfig(productionConfig({ clientOrigin: 'http://demo.example.com' })),
        /CLIENT_ORIGIN must use https/
    );
});
