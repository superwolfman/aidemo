import { useCallback, useState } from 'react';
import * as sessionService from '../services/sessionService';

export function useSession() {
    const [sessions, setSessions] = useState<any[]>([]);
    const [active, setActive] = useState<any>(null);

    const load = useCallback(async () => {
        const result = await sessionService.listAgentStudioSessions();
        if (result.sessions?.length) {
            setSessions(result.sessions);
            setActive((current: any) => current || result.sessions[0]);
        } else {
            const created = await sessionService.createAgentStudioSession('Agent Runtime 首次会话');
            setSessions([created.session]);
            setActive(created.session);
        }
    }, []);

    const create = useCallback(async (title = '新的 Agent Runtime 会话') => {
        const created = await sessionService.createAgentStudioSession(title);
        setSessions((items) => [created.session, ...items]);
        setActive(created.session);
        return created.session;
    }, []);

    const refresh = useCallback(async () => {
        const result = await sessionService.listAgentStudioSessions();
        setSessions(result.sessions || []);
        setActive((current: any) => current || result.sessions?.[0] || null);
    }, []);

    return { sessions, setSessions, active, setActive, load, create, refresh };
}