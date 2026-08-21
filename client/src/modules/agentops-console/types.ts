export type AgentSession = {
  _id: string;
  title: string;
};

export type TraceStep = {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'success' | 'waiting' | 'failed' | 'paused' | 'cancelled' | 'review_required';
  durationMs?: number;
  tokenUsage?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  tool?: string;
  humanRequired?: boolean;
};

export type AgentRun = {
  _id: string;
  runId: string;
  status: string;
  prompt: string;
  intent?: { id?: string; label: string; goal: string; riskLevel: string; confidence?: number; signals?: string[]; scopes?: string[] };
  commandOptions?: { agentId?: string; skillId?: string; scopes?: string[]; taskModeId?: string; source?: string };
  selectedSkill?: { id?: string; name: string; tools: string[] };
  executionContext?: {
    source: string;
    taskMode?: { id: string; label: string } | null;
    requestedAgentId?: string | null;
    requestedSkillId?: string | null;
    resolvedAgentId?: string | null;
  };
  plan?: Array<{ id: string; name: string; owner: string; status: string; tool: string; guardrail: string }>;
  sources?: Array<{ _id: string; documentTitle: string; score: number; retrievalBackend?: string; content: string }>;
  artifacts?: Array<{
    id: string;
    title: string;
    type: string;
    status: string;
    version?: number;
    reviewStatus?: string;
    traceStepId?: string;
    sourceRefs?: Array<{ id: string; index: number; title: string; score: number; retrievalBackend?: string }>;
    versions?: Array<{ version: number; status: string; createdAt: string }>;
    approvals?: Array<{ action: string; note?: string; createdAt: string }>;
    exports?: Array<{ id: string; format: string; filename: string; exportedAt: string }>;
  }>;
  trace?: TraceStep[];
  logs?: Array<{ id: string; level: string; message: string; at: string; action?: string }>;
  quality?: {
    score: number;
    passed: number;
    total: number;
    verdict: string;
    checks?: Array<{ key: string; label: string; passed: boolean; value: string }>;
  };
  stateTransitions?: Array<{ id: string; from: string; to: string; label: string; at: string; reason?: string }>;
  reviewHistory?: Array<{ _id?: string; action: string; note?: string; reviewerId?: string; nextStatus?: string; createdAt?: string }>;
  controlHistory?: Array<{ id: string; action: string; status: string; reason?: string; createdAt: string }>;
  evalResult?: { score: number; passed: number; total: number; verdict: string };
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
  ragDiagnostics?: {
    retrieval?: { effectiveScopes?: string[]; scopeSource?: string };
  };
  createdAt?: string;
};

export type Capability = {
  id: string;
  name: string;
  description: string;
  intents: string[];
  tools: string[];
};

export type Blueprint = {
  capabilities: Capability[];
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
    };
  };
};

export type RagRuntime = Blueprint['runtime']['rag'];
export type RunSource = NonNullable<AgentRun['sources']>[number];

export type RuntimeMetrics = {
  total: number;
  failed: number;
  waiting: number;
  confirmed: number;
  avgLatency: number;
  tokens: number;
  assessed: number;
  avgQuality: number;
};

export type MetricTrends = {
  latency: string;
  tokens: string;
  quality: string;
};
