import assert from 'node:assert/strict';
import test from 'node:test';
import {
    RECOMMENDED_PUBLIC_HOST,
    validateProductionDomainConfig,
    verifyProductionDomain
} from '../../scripts/production-domain.mjs';

const validConfig = {
    publicHost: RECOMMENDED_PUBLIC_HOST,
    publicBaseUrl: `https://${RECOMMENDED_PUBLIC_HOST}`,
    originPublicIp: '8.217.153.138'
};

test('production domain requires an exact HTTPS origin', () => {
    assert.deepEqual(validateProductionDomainConfig(validConfig), validConfig);
    assert.throws(() => validateProductionDomainConfig({
        ...validConfig,
        publicBaseUrl: `http://${RECOMMENDED_PUBLIC_HOST}`
    }), /HTTPS origin/);
});

test('production domain must resolve to the ECS public IP', async () => {
    const result = await verifyProductionDomain(validConfig, {
        resolve4: async () => ['8.217.153.138']
    });
    assert.deepEqual(result.addresses, ['8.217.153.138']);

    await assert.rejects(() => verifyProductionDomain(validConfig, {
        resolve4: async () => ['203.0.113.10']
    }), /must resolve/);
});
