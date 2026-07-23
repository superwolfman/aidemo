import { now } from './agentRuntimeService.js';

export function normalizeSourceRef(source, index) {
  return {
    id: source._id || source.id || `source-${index + 1}`,
    index: index + 1,
    title: source.documentTitle || source.title || 'Untitled source',
    score: Number(source.score || 0),
    retrievalBackend: source.retrievalBackend,
    sourcePath: source.sourcePath
  };
}

export function attachArtifactWorkflow(artifacts, traceStepId = 'tool', sources = []) {
  const sourceRefs = sources.map(normalizeSourceRef);
  return artifacts.map((artifact) => ({
    ...artifact,
    status: artifact.status || 'draft',
    version: 1,
    traceStepId,
    generatedBy: {
      tool: 'planDelivery',
      traceStepId,
      generatedAt: now()
    },
    sourceRefs,
    sourceIds: sourceRefs.map((source) => source.id),
    reviewStatus: 'pending',
    versions: [
      {
        version: 1,
        status: 'created',
        content: artifact.content,
        createdAt: now()
      }
    ],
    approvals: [],
    exports: []
  }));
}
