import { useCallback, useState } from 'react';
import * as artifactService from '../services/artifactService';

export function useArtifact() {
    const [activeArtifactId, setActiveArtifactId] = useState('');
    const [artifactDraft, setArtifactDraft] = useState('');

    const update = useCallback(async (runId: string, artifact: any, patch: Record<string, unknown>) => {
        const result = await artifactService.updateArtifact(runId, artifact.id, patch);
        return result.run;
    }, []);

    const confirm = useCallback(async (runId: string, artifact: any, note = '') => {
        const result = await artifactService.confirmArtifact(runId, artifact.id, note);
        return result.run;
    }, []);

    const review = useCallback(async (runId: string, artifact: any, note = '') => {
        const result = await artifactService.reviewArtifact(runId, artifact.id, note);
        return result.run;
    }, []);

    const exportFile = useCallback(async (runId: string, artifact: any, format: 'markdown' | 'json') => {
        const result = await artifactService.exportArtifact(runId, artifact.id, format);
        return result;
    }, []);

    const select = useCallback((artifact: any, draftOf: (content: any) => string) => {
        setActiveArtifactId(artifact.id);
        setArtifactDraft(draftOf(artifact.content));
    }, []);

    return {
        activeArtifactId, setActiveArtifactId, artifactDraft, setArtifactDraft,
        update, confirm, review, exportFile, select
    };
}