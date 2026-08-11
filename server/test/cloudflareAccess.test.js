import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import {
    AccessIdentityError,
    clearCloudflareJwksCache,
    verifyCloudflareAccessJwt
} from '../src/security/cloudflareAccess.js';

const teamDomain = 'team.cloudflareaccess.com';
const issuer = `https://${teamDomain}`;
const audience = 'access-app-audience';

function fixture () {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    Object.assign(jwk, { kid: 'test-key', alg: 'RS256', use: 'sig' });
    const fetchImpl = async () => ({
        ok: true,
        status: 200,
        async json () { return { keys: [jwk] }; }
    });
    return { privateKey, fetchImpl };
}

test('Cloudflare Access assertion verifies signature, issuer, audience and email', async () => {
    clearCloudflareJwksCache();
    const { privateKey, fetchImpl } = fixture();
    const assertion = jwt.sign(
        { email: 'Interviewer@Example.com', name: 'Interviewer' },
        privateKey,
        {
            algorithm: 'RS256',
            keyid: 'test-key',
            issuer,
            audience,
            subject: 'access-user-1',
            expiresIn: '5m'
        }
    );

    const identity = await verifyCloudflareAccessJwt(assertion, {
        teamDomain,
        audience,
        allowedEmails: ['interviewer@example.com'],
        fetchImpl
    });
    assert.equal(identity.sub, 'access-user-1');
    assert.equal(identity.email, 'interviewer@example.com');
});

test('Cloudflare Access assertion rejects an email outside the exact allowlist', async () => {
    clearCloudflareJwksCache();
    const { privateKey, fetchImpl } = fixture();
    const assertion = jwt.sign(
        { email: 'other@example.com' },
        privateKey,
        {
            algorithm: 'RS256',
            keyid: 'test-key',
            issuer,
            audience,
            subject: 'access-user-2',
            expiresIn: '5m'
        }
    );

    await assert.rejects(
        verifyCloudflareAccessJwt(assertion, {
            teamDomain,
            audience,
            allowedEmails: ['interviewer@example.com'],
            fetchImpl
        }),
        (error) => error instanceof AccessIdentityError && error.code === 'ACCESS_EMAIL_NOT_ALLOWED'
    );
});

test('Cloudflare Access assertion rejects the wrong audience', async () => {
    clearCloudflareJwksCache();
    const { privateKey, fetchImpl } = fixture();
    const assertion = jwt.sign(
        { email: 'interviewer@example.com' },
        privateKey,
        {
            algorithm: 'RS256',
            keyid: 'test-key',
            issuer,
            audience: 'another-app',
            subject: 'access-user-3',
            expiresIn: '5m'
        }
    );

    await assert.rejects(
        verifyCloudflareAccessJwt(assertion, { teamDomain, audience, fetchImpl }),
        (error) => error instanceof AccessIdentityError && error.code === 'ACCESS_IDENTITY_INVALID'
    );
});
