import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const jwksCache = new Map();

export class AccessIdentityError extends Error {
    constructor (message, code = 'ACCESS_IDENTITY_INVALID', statusCode = 401) {
        super(message);
        this.name = 'AccessIdentityError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function issuerForTeamDomain (teamDomain) {
    const normalized = String(teamDomain || '')
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '');
    return normalized ? `https://${normalized}` : '';
}

async function fetchJwks (issuer, fetchImpl, cacheTtlMs, forceRefresh = false) {
    const cached = jwksCache.get(issuer);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.keys;

    let response;
    try {
        response = await fetchImpl(`${issuer}/cdn-cgi/access/certs`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(5000)
        });
    } catch (error) {
        throw new AccessIdentityError(
            `Unable to load Cloudflare Access signing keys: ${error.message}`,
            'ACCESS_JWKS_UNAVAILABLE',
            503
        );
    }
    if (!response.ok) {
        throw new AccessIdentityError(
            `Cloudflare Access signing keys returned HTTP ${response.status}`,
            'ACCESS_JWKS_UNAVAILABLE',
            503
        );
    }
    const payload = await response.json();
    const keys = Array.isArray(payload?.keys) ? payload.keys : [];
    if (!keys.length) {
        throw new AccessIdentityError(
            'Cloudflare Access signing keys are empty',
            'ACCESS_JWKS_UNAVAILABLE',
            503
        );
    }
    jwksCache.set(issuer, { keys, expiresAt: Date.now() + cacheTtlMs });
    return keys;
}

function assertAllowedEmail (email, allowedEmails) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized || !/^\S+@\S+\.\S+$/.test(normalized)) {
        throw new AccessIdentityError('Cloudflare Access token has no valid email claim');
    }
    const allowlist = (allowedEmails || []).map((value) => String(value).toLowerCase());
    if (allowlist.length && !allowlist.includes(normalized)) {
        throw new AccessIdentityError(
            'This Cloudflare Access identity is not enabled for the demo',
            'ACCESS_EMAIL_NOT_ALLOWED',
            403
        );
    }
    return normalized;
}

/**
 * Verifies the assertion injected by Cloudflare Access at the origin boundary.
 * The Access policy is the primary allowlist; allowedEmails is an optional
 * application-side exact-email allowlist for defence in depth.
 */
export async function verifyCloudflareAccessJwt (assertion, {
    teamDomain,
    audience,
    allowedEmails = [],
    fetchImpl = globalThis.fetch,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS
} = {}) {
    if (!assertion) {
        throw new AccessIdentityError(
            'Missing Cloudflare Access assertion',
            'ACCESS_ASSERTION_MISSING'
        );
    }
    const issuer = issuerForTeamDomain(teamDomain);
    if (!issuer || !audience) {
        throw new AccessIdentityError(
            'Cloudflare Access verification is not configured',
            'ACCESS_NOT_CONFIGURED',
            503
        );
    }

    const decoded = jwt.decode(assertion, { complete: true });
    const kid = decoded?.header?.kid;
    if (!kid || decoded?.header?.alg !== 'RS256') {
        throw new AccessIdentityError('Cloudflare Access token header is invalid');
    }

    let keys = await fetchJwks(issuer, fetchImpl, cacheTtlMs);
    let jwk = keys.find((candidate) => candidate?.kid === kid && candidate?.kty === 'RSA');
    if (!jwk) {
        keys = await fetchJwks(issuer, fetchImpl, cacheTtlMs, true);
        jwk = keys.find((candidate) => candidate?.kid === kid && candidate?.kty === 'RSA');
        if (!jwk) {
            throw new AccessIdentityError(
                'Cloudflare Access signing key was not found',
                'ACCESS_SIGNING_KEY_NOT_FOUND'
            );
        }
    }

    let payload;
    try {
        const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
        payload = jwt.verify(assertion, publicKey, {
            algorithms: ['RS256'],
            audience,
            issuer
        });
    } catch {
        throw new AccessIdentityError('Cloudflare Access token verification failed');
    }

    const subject = String(payload.sub || '').trim();
    if (!subject) {
        throw new AccessIdentityError('Cloudflare Access token has no subject claim');
    }
    return Object.freeze({
        sub: subject,
        email: assertAllowedEmail(payload.email, allowedEmails),
        name: String(payload.name || payload.email || '').trim(),
        issuedAt: payload.iat,
        expiresAt: payload.exp,
        issuer
    });
}

export function clearCloudflareJwksCache () {
    jwksCache.clear();
}
