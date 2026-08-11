import dns from 'node:dns/promises';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

export const RECOMMENDED_PUBLIC_HOST = 'app.agentdelivery.com';

// Keep this list aligned with deploy/Caddyfile. Source:
// https://www.cloudflare.com/ips-v4/
export const CLOUDFLARE_IPV4_CIDRS = Object.freeze([
    '173.245.48.0/20',
    '103.21.244.0/22',
    '103.22.200.0/22',
    '103.31.4.0/22',
    '141.101.64.0/18',
    '108.162.192.0/18',
    '190.93.240.0/20',
    '188.114.96.0/20',
    '197.234.240.0/22',
    '198.41.128.0/17',
    '162.158.0.0/15',
    '104.16.0.0/13',
    '104.24.0.0/14',
    '172.64.0.0/13',
    '131.0.72.0/22'
]);

function ipv4ToInteger (address) {
    if (net.isIP(address) !== 4) return null;
    return address.split('.').reduce((value, octet) => (
        ((value << 8) | Number(octet)) >>> 0
    ), 0);
}

export function isIpv4InCidr (address, cidr) {
    const [networkAddress, prefixText] = String(cidr).split('/');
    const addressValue = ipv4ToInteger(address);
    const networkValue = ipv4ToInteger(networkAddress);
    const prefix = Number(prefixText);
    if (addressValue === null || networkValue === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
        return false;
    }
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (addressValue & mask) === (networkValue & mask);
}

export function isCloudflareIpv4 (address) {
    return CLOUDFLARE_IPV4_CIDRS.some((cidr) => isIpv4InCidr(address, cidr));
}

export function validateProductionDomainConfig ({
    publicHost,
    publicBaseUrl,
    originPublicIp,
    edgeProxyMode = 'cloudflare'
}) {
    const errors = [];
    const host = String(publicHost || '').trim().toLowerCase();
    const baseUrl = String(publicBaseUrl || '').trim();
    const originIp = String(originPublicIp || '').trim();

    if (!host || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) {
        errors.push('PUBLIC_HOST must be a valid DNS hostname');
    }
    if (net.isIP(host) || /(?:^|\.)(?:sslip\.io|nip\.io)$/.test(host)) {
        errors.push('PUBLIC_HOST must use an owned domain and must not expose an encoded origin IP');
    }
    if (edgeProxyMode !== 'cloudflare') {
        errors.push('EDGE_PROXY_MODE must be cloudflare for the public production deployment');
    }
    if (net.isIP(originIp) !== 4) {
        errors.push('ORIGIN_PUBLIC_IP must be a valid IPv4 address');
    }

    try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== 'https:') errors.push('VITE_API_BASE must use https://');
        if (parsed.hostname.toLowerCase() !== host) errors.push('VITE_API_BASE hostname must equal PUBLIC_HOST');
        if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password || parsed.port) {
            errors.push('VITE_API_BASE must be an origin URL without credentials, port, path, query, or fragment');
        }
    } catch {
        errors.push('VITE_API_BASE must be a valid URL');
    }

    if (errors.length) {
        const error = new Error(errors.join('; '));
        error.code = 'PRODUCTION_DOMAIN_CONFIG_INVALID';
        throw error;
    }
    return { publicHost: host, publicBaseUrl: baseUrl, originPublicIp: originIp, edgeProxyMode };
}

export async function verifyCloudflareProxy (options, resolver = dns) {
    const config = validateProductionDomainConfig(options);
    let addresses;
    try {
        addresses = [...new Set(await resolver.resolve4(config.publicHost))];
    } catch (cause) {
        const error = new Error(`PUBLIC_HOST cannot be resolved: ${config.publicHost}`, { cause });
        error.code = 'PRODUCTION_DOMAIN_DNS_UNAVAILABLE';
        throw error;
    }
    if (!addresses.length) {
        const error = new Error(`PUBLIC_HOST has no IPv4 records: ${config.publicHost}`);
        error.code = 'PRODUCTION_DOMAIN_DNS_EMPTY';
        throw error;
    }
    if (addresses.includes(config.originPublicIp)) {
        const error = new Error('Cloudflare proxy is disabled: DNS exposes ORIGIN_PUBLIC_IP');
        error.code = 'PRODUCTION_ORIGIN_IP_EXPOSED';
        throw error;
    }
    const nonCloudflareAddresses = addresses.filter((address) => !isCloudflareIpv4(address));
    if (nonCloudflareAddresses.length) {
        const error = new Error(`PUBLIC_HOST returned non-Cloudflare addresses: ${nonCloudflareAddresses.join(', ')}`);
        error.code = 'PRODUCTION_DOMAIN_NOT_CLOUDFLARE';
        throw error;
    }
    return { ...config, addresses };
}

async function main () {
    const result = await verifyCloudflareProxy({
        publicHost: process.env.PUBLIC_HOST,
        publicBaseUrl: process.env.VITE_API_BASE,
        originPublicIp: process.env.ORIGIN_PUBLIC_IP,
        edgeProxyMode: process.env.EDGE_PROXY_MODE
    });
    console.log(`✓ Cloudflare proxy verified for ${result.publicHost} (${result.addresses.length} anycast address(es))`);
    console.log('✓ DNS does not expose ORIGIN_PUBLIC_IP');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((error) => {
        console.error(`✗ ${error.message}`);
        process.exitCode = 1;
    });
}
