import dns from 'node:dns/promises';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

export const RECOMMENDED_PUBLIC_HOST = 'app.agentdelivery.asia';

export function validateProductionDomainConfig ({
    publicHost,
    publicBaseUrl,
    originPublicIp
}) {
    const host = String(publicHost || '').trim().toLowerCase();
    const baseUrl = String(publicBaseUrl || '').trim();
    const originIp = String(originPublicIp || '').trim();

    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) {
        throw new Error('PUBLIC_HOST must be a valid DNS hostname');
    }
    if (net.isIP(originIp) !== 4) {
        throw new Error('ORIGIN_PUBLIC_IP must be a valid IPv4 address');
    }

    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'https:' || parsed.host.toLowerCase() !== host || parsed.pathname !== '/') {
        throw new Error('VITE_API_BASE must be the HTTPS origin of PUBLIC_HOST');
    }

    return { publicHost: host, publicBaseUrl: baseUrl, originPublicIp: originIp };
}

export async function verifyProductionDomain (options, resolver = dns) {
    const config = validateProductionDomainConfig(options);
    const addresses = [...new Set(await resolver.resolve4(config.publicHost))];
    if (!addresses.includes(config.originPublicIp)) {
        throw new Error(`${config.publicHost} must resolve to ${config.originPublicIp}`);
    }
    return { ...config, addresses };
}

async function main () {
    const result = await verifyProductionDomain({
        publicHost: process.env.PUBLIC_HOST,
        publicBaseUrl: process.env.VITE_API_BASE,
        originPublicIp: process.env.ORIGIN_PUBLIC_IP
    });
    console.log(`✓ ${result.publicHost} resolves to ${result.originPublicIp}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((error) => {
        console.error(`✗ ${error.message}`);
        process.exitCode = 1;
    });
}
