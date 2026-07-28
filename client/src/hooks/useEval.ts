import { useCallback, useState } from 'react';
import * as evalService from '../services/evalService';

export function useEval(kind: 'agent-studio' | 'copilot' = 'agent-studio') {
    const [cases, setCases] = useState<any[]>([]);

    const load = useCallback(async () => {
        const result = kind === 'agent-studio'
            ? await evalService.listAgentStudioEvalCases()
            : await evalService.listCopilotEvalCases();
        setCases(result.cases || []);
        return result;
    }, [kind]);

    const refresh = useCallback(async () => {
        const result = kind === 'agent-studio'
            ? await evalService.listAgentStudioEvalCases()
            : await evalService.listCopilotEvalCases();
        setCases(result.cases || []);
        return result;
    }, [kind]);

    const score = useCallback(async (evalCaseId: string, runId: string) => {
        const result = await evalService.scoreAgentStudioEvalCase(evalCaseId, runId);
        return result.run;
    }, []);

    return { cases, setCases, load, refresh, score };
}