export type AgentSession = {
    _id: string;
    title: string;
    messages: Array<{ id: string; role: 'user' | 'assistant'; content: string }>;
};

export type Source = {
    _id: string;
    documentTitle: string;
    content: string;
    score: number;
    vectorScore?: number;
    retrievalBackend?: string;
    sourcePath?: string;
    candidateRank?: number;
    vectorRank?: number;
    rerankScore?: number;
    rerankStrategy?: string;
    filterReason?: string;
};

export type FilteredChunk = {
    id?: string;
    title?: string;
    score?: number;
    reason?: string;
};

export type Artifact = {
    id: string;
    type: string;
    title: string;
    status: string;
    content: string | Record<string, unknown>;
    version?: number;
    traceStepId?: string;
    reviewStatus?: string;
    versions?: Array<{ version: number; status: string; createdAt: string }>;
    approvals?: Array<{ action: string; note?: string; createdAt: string }>;
    exports?: Array<{ id: string; format: string; filename: string; exportedAt: string }>;
    sourceRefs?: Array<{ id: string; index: number; title: string; score: number; retrievalBackend?: string }>;
    generatedBy?: { tool: string; traceStepId: string; generatedAt: string };
    evalId?: string;
};

export type TraceStep = {
    id: string;
    name: string;
    status: string;
    durationMs?: number;
    tokenUsage?: number;
    error?: string;
    input?: unknown;
    output?: unknown;
};

export type RunQuality = {
    score: number;
    passed: number;
    total: number;
    verdict: string;
    citationHitCount?: number;
    capabilities?: {
        realVector: boolean;
        realProvider: boolean;
        fallbackRetrieval: boolean;
        retrievalBackends: string[];
    };
}
export type AgentRun = {
    _id: string;
    runId: string;
    status: string;
    answer?: string;
    sources?: Source[];
    filteredChunks?: FilteredChunk[];
    retrievalQuery?: string;
    ragDiagnostics?: {
        chunkCount?: number;
        documentCount?: number;
        vectorSearchReady?: boolean;
        error?: string;
        status?: RagRuntime;
        outcome?: RetrievalOutcome;
        retrieval?: {
            query?: string;
            originalQuery?: string;
            fullTextQuery?: string;
            entities?: string[];
            knowledgeDomain?: string | null;
            taskModeId?: string | null;
            effectiveScopes?: string[];
            queryStrategy?: string;
            requestedTopK?: number;
            candidateLimit?: number;
            numCandidates?: number;
            outcome?: RetrievalOutcome;
        };
    };
    retrievalOutcome?: RetrievalOutcome;
    artifacts?: Artifact[];
    trace?: TraceStep[];
    quality?: RunQuality;
    provider?: {
        provider?: string;
        mode?: string;
        model?: string;
        requestedModel?: string;
        primaryModel?: string;
        runtimeVersion?: number;
        fallbackUsed?: boolean;
        attemptedModels?: string[];
    };
};

export type RetrievalOutcome = {
    type: 'success' | 'knowledge_gap';
    code?: 'NO_RELEVANT_EVIDENCE' | 'KNOWLEDGE_BASE_EMPTY';
    message?: string;
    hitCount?: number;
    effectiveScopes?: string[];
};

export type EvalCase = {
    id: string;
    title: string;
    prompt: string;
    expected: string[];
    lastResult?: RunQuality;
    evalHistory?: Array<{ score: number; verdict: string; createdAt: string }>;
};

export type RuntimeBlueprint = {
    runtime: {
        llm: { provider: string; mode: string; model: string; configured: boolean };
        rag: {
            backend?: string;
            retrievalBackend?: string;
            vectorStore: string;
            productionReady: boolean;
            mode?: string;
            error?: string;
            index?: string;
            vectorPath?: string;
            dimensions?: number;
            connection?: string;
            connected?: boolean;
            vectorSearchReady?: boolean;
            embeddingProvider?: string;
        };
    };
};

export type RagRuntime = RuntimeBlueprint['runtime']['rag'];

export type RetrievalView = {
    live: boolean;
    backend: string;
    label: string;
    warning: string;
};

export type DeliveryTaskMode = {
    id: string;
    title: string;
    desc: string;
    agentId: string;
    scopes: string[];
    promptSuffix: string;
};

export type ArtifactSummaryItem = {
    type: string;
    title: string;
    artifact?: Artifact;
    done: boolean;
    confirmed: boolean;
};
