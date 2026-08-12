import { request } from '../api/client';

export type RuntimeModelRef = { provider: string; model: string };

export type RuntimeModelCatalogItem = RuntimeModelRef & {
    id: string;
    label: string;
    purpose: string;
    deliveryEligible: boolean;
    freeTierEligible: boolean;
    freeTierStatus: 'console-managed' | 'not-applicable';
    credentialConfigured: boolean;
    credentialSource: 'server-secret';
};

export type RuntimeModelSetting = {
    key: string;
    version: number;
    primary: RuntimeModelRef;
    fallbackChain: RuntimeModelRef[];
    fallbackPolicy: { triggers: string[]; maxAttempts: number };
    updatedBy?: { id: string; email: string };
    updatedAt?: string;
    changeNote?: string;
    source: string;
};

export type RuntimeModelVersion = {
    _id: string;
    version: number;
    primary: RuntimeModelRef;
    fallbackChain: RuntimeModelRef[];
    action: 'initialize' | 'publish' | 'rollback';
    rollbackFromVersion?: number | null;
    changeNote?: string;
    changedBy?: { id: string; email: string };
    changedAt?: string;
};

export type RuntimeModelSettingsResponse = {
    setting: RuntimeModelSetting;
    catalog: RuntimeModelCatalogItem[];
    history: RuntimeModelVersion[];
};

export function getRuntimeModelSettings(): Promise<RuntimeModelSettingsResponse> {
    return request('/api/agent-studio/runtime-settings/models');
}

export function publishRuntimeModelSettings(payload: {
    primary: RuntimeModelRef;
    fallbackChain: RuntimeModelRef[];
    expectedVersion: number;
    changeNote: string;
}): Promise<RuntimeModelSettingsResponse> {
    return request('/api/agent-studio/runtime-settings/models', {
        method: 'PUT',
        body: JSON.stringify(payload)
    });
}

export function testRuntimeModel(model: RuntimeModelRef): Promise<{
    ok: boolean;
    provider: string;
    model: string;
    latencyMs: number;
    credentialSource: string;
}> {
    return request('/api/agent-studio/runtime-settings/models/test', {
        method: 'POST',
        body: JSON.stringify(model)
    });
}

export function rollbackRuntimeModelSettings(payload: {
    targetVersion: number;
    expectedVersion: number;
    changeNote: string;
}): Promise<RuntimeModelSettingsResponse> {
    return request('/api/agent-studio/runtime-settings/models/rollback', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}
