import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
    CLOUDFLARE_IPV4_CIDRS,
    RECOMMENDED_PUBLIC_HOST,
    isCloudflareIpv4,
    isIpv4InCidr,
    validateProductionDomainConfig,
    verifyCloudflareProxy
} from '../../scripts/production-domain.mjs';

const validConfig = {
    publicHost: RECOMMENDED_PUBLIC_HOST,
    publicBaseUrl: `https://${RECOMMENDED_PUBLIC_HOST}`,
    originPublicIp: '8.217.153.138',
    edgeProxyMode: 'cloudflare'
};

test('production domain requires owned HTTPS hostname and Cloudflare mode', () => {
    assert.deepEqual(validateProductionDomainConfig(validConfig), validConfig);
    assert.throws(() => validateProductionDomainConfig({
        ...validConfig,
        publicHost: '8-217-153-138.sslip.io',
        publicBaseUrl: 'https://8-217-153-138.sslip.io'
    }), /owned domain/);
    assert.throws(() => validateProductionDomainConfig({
        ...validConfig,
        publicBaseUrl: 'http://app.agentdelivery.com'
    }), /https/);
    assert.throws(() => validateProductionDomainConfig({
        ...validConfig,
        edgeProxyMode: 'direct'
    }), /must be cloudflare/);
});

test('Cloudflare IPv4 matcher observes CIDR boundaries', () => {
    assert.equal(isIpv4InCidr('104.16.0.1', '104.16.0.0/13'), true);
    assert.equal(isIpv4InCidr('104.23.255.255', '104.16.0.0/13'), true);
    assert.equal(isIpv4InCidr('104.24.0.1', '104.16.0.0/13'), false);
    assert.equal(isCloudflareIpv4('172.64.12.34'), true);
    assert.equal(isCloudflareIpv4('8.217.153.138'), false);
});

test('production DNS verification accepts only Cloudflare addresses', async () => {
    const result = await verifyCloudflareProxy(validConfig, {
        resolve4: async () => ['104.16.12.1', '172.64.10.2', '104.16.12.1']
    });
    assert.deepEqual(result.addresses, ['104.16.12.1', '172.64.10.2']);

    await assert.rejects(() => verifyCloudflareProxy(validConfig, {
        resolve4: async () => ['8.217.153.138']
    }), (error) => error.code === 'PRODUCTION_ORIGIN_IP_EXPOSED');

    await assert.rejects(() => verifyCloudflareProxy(validConfig, {
        resolve4: async () => ['203.0.113.10']
    }), (error) => error.code === 'PRODUCTION_DOMAIN_NOT_CLOUDFLARE');
});

test('Caddy trusted proxy and origin allowlists include every validated Cloudflare IPv4 CIDR', async () => {
    const caddyfile = await fs.readFile(new URL('../../deploy/Caddyfile', import.meta.url), 'utf8');
    for (const cidr of CLOUDFLARE_IPV4_CIDRS) {
        assert.equal(caddyfile.split(cidr).length - 1, 2, `${cidr} must exist in both Caddy allowlists`);
    }
});
