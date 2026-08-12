import { request } from '../api/client';

export type TimeoutDefaults = {
    requestTimeoutMs: number;
    streamTotalTimeoutMs: number;
    firstTokenTimeoutMs: number;
    idleTimeoutMs: number;
    connectProbeMs: number;
};

export type TimeoutOverride = Partial<TimeoutDefaults>;

export type TimeoutPolicy = {
    defaults: TimeoutDefaults;
    perModel: Record<string, TimeoutOverride>;
    fallbackPolicy: { triggers: string[]; maxAttempts: number };
    retryPolicy: {
        maxRetries: number;
        retryableErrors: string[];
        backoffBaseMs: number;
        backoffMaxMs: number;
    };
};

export type RuntimeTimeoutSetting = TimeoutPolicy & {
    key: string;
    version: number;
    updatedBy?: { id: string; email: string };
    updatedAt?: string;
    changeNote?: string;
    source: string;
};

export type RuntimeTimeoutVersion = {
    _id: string;
    version: number;
    defaults: TimeoutDefaults;
    perModel: Record<string, TimeoutOverride>;
    action: 'initialize' | 'publish' | 'rollback';
    rollbackFromVersion?: number | null;
    changeNote?: string;
    changedBy?: { id: string; email: string };
    changedAt?: string;
};

export type RuntimeTimeoutSettingsResponse = {
    setting: RuntimeTimeoutSetting;
    history: RuntimeTimeoutVersion[];
};

export function getRuntimeTimeoutSettings(): Promise<RuntimeTimeoutSettingsResponse> {
    return request('/api/agent-studio/runtime-settings/timeout');
}

export function publishRuntimeTimeoutSettings(payload: TimeoutPolicy & {
    expectedVersion: number;
    changeNote: string;
}): Promise<RuntimeTimeoutSettingsResponse> {
    return request('/api/agent-studio/runtime-settings/timeout', {
        method: 'PUT',
        body: JSON.stringify(payload)
    });
}

export function rollbackRuntimeTimeoutSettings(payload: {
    targetVersion: number;
    expectedVersion: number;
    changeNote: string;
}): Promise<RuntimeTimeoutSettingsResponse> {
    return request('/api/agent-studio/runtime-settings/timeout/rollback', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export type LlmTimingStats = Record<string, {
    count: number;
    timeoutCount: number;
    timeoutRate: number;
    ttftP50: number | null;
    ttftP95: number | null;
    totalP50: number | null;
    totalP95: number | null;
}>;

export type ThresholdSuggestion = {
    firstTokenTimeoutMs: number | null;
    streamTotalTimeoutMs: number;
    requestTimeoutMs: number;
    sampleCount: number;
    ttftP95: number | null;
    totalP95: number | null;
} | null;

export function getLlmTimingStats(): Promise<{ stats: LlmTimingStats; suggestions: Record<string, ThresholdSuggestion> }> {
    return request('/api/agent-studio/runtime-settings/timeout/stats');
}
