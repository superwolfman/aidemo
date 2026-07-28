import { useCallback, useState } from 'react';
import * as ragService from '../services/ragService';

export function useRagDebug() {
    const [health, setHealth] = useState<any>(null);
    const [results, setResults] = useState<any[]>([]);
    const [searching, setSearching] = useState(false);
    const [checking, setChecking] = useState(false);

    const check = useCallback(async () => {
        setChecking(true);
        try { setHealth(await ragService.checkHealth()); }
        finally { setChecking(false); }
    }, []);

    const search = useCallback(async (query: string, scopes?: string[], limit = 4) => {
        setSearching(true);
        try {
            const result = await ragService.search(query, scopes, limit);
            setResults(result.sources || []);
            return result;
        } finally { setSearching(false); }
    }, []);

    return { health, setHealth, results, setResults, searching, setSearching, checking, setChecking, check, search };
}