import { useCallback, useMemo, useRef } from 'react';

function getNamespace(tenantId: string, userId: string) {
    return `aidemo:tenant-session:${tenantId}:${userId}`;
}

function read<T>(key: string): T | null {
    try {
        const raw = sessionStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}

function write<T>(key: string, value: T) {
    try {
        sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
        // 存储已满或隐私模式，静默失败
    }
}

function remove(key: string) {
    try {
        sessionStorage.removeItem(key);
    } catch {
        // ignore
    }
}

export interface TenantSessionSnapshot {
    activeSessionId?: string;
    activeRunId?: string;
    activeArtifactId?: string;
    prompt?: string;
    form?: Record<string, string>;
    skillId?: string;
    taskModeId?: string;
    selectedWorkflowArtifactType?: string;
    selectedEvalCaseId?: string;
    requirement?: string;
    audience?: string;
    deadline?: string;
    constraints?: string;
    runId?: string;
    expandedPanels?: Record<string, boolean>;
    savedAt?: string;
}

export function useTenantSessionState(tenantId: string | undefined, userId: string | undefined) {
    const ns = useMemo(() => {
        if (!tenantId || !userId) return null;
        return getNamespace(tenantId, userId);
    }, [tenantId, userId]);

    // 用 ref 保存当前 ns，避免 setSnapshot 依赖 getSnapshot 导致引用变化
    const nsRef = useRef(ns);
    nsRef.current = ns;

    const getSnapshot = useCallback((): TenantSessionSnapshot | null => {
        const key = nsRef.current;
        if (!key) return null;
        return read<TenantSessionSnapshot>(key);
    }, []);

    const setSnapshot = useCallback((snapshot: TenantSessionSnapshot) => {
        const key = nsRef.current;
        if (!key) return;
        const current = read<TenantSessionSnapshot>(key) || {};
        write<TenantSessionSnapshot>(key, {
            ...current,
            ...snapshot,
            savedAt: new Date().toISOString()
        });
    }, []);

    const clearSnapshot = useCallback(() => {
        const key = nsRef.current;
        if (!key) return;
        remove(key);
    }, []);

    return useMemo(
        () => ({ getSnapshot, setSnapshot, clearSnapshot }),
        [getSnapshot, setSnapshot, clearSnapshot]
    );
}
