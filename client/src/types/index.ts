export type RunStatus =
    | 'created' | 'intent_detected' | 'skill_selected' | 'retrieving'
    | 'tool_running' | 'streaming' | 'review_required'
    | 'confirmed' | 'rejected' | 'rolled_back' | 'failed' | 'cancelled' | 'paused';

export interface SourceRef { documentTitle: string; score: number; retrievalBackend?: string; content?: string; sourcePath?: string; chunkIndex?: number; tags?: string[]; sourceType?: string; }
export interface Artifact { id: string; type: string; title: string; status: string; content: string | Record<string, unknown>; version?: number; reviewStatus?: string; traceStepId?: string; versions?: Array<{ version: number; status: string; at?: string; createdAt?: string; content?: unknown }>; approvals?: Array<{ action: string; note?: string; reviewerId?: string; createdAt: string }>; }
export interface AgentRun { _id: string; runId: string; status: string; prompt: string; intent?: any; selectedSkill?: any; plan?: any[]; sources?: SourceRef[]; artifacts?: Artifact[]; trace?: any[]; logs?: any[]; answer?: string; createdAt?: string; review?: any; controlState?: any; provider?: Record<string, unknown>; quality?: RunQuality; evalCaseId?: string; stateTransitions?: any[]; reviewHistory?: any[]; controlHistory?: any[]; evalResult?: any; }
export interface RunQuality { score: number; passed: number; total: number; avgCitationScore: number; verdict: string; checks: Array<{ key: string; label: string; passed: boolean; value: string }>; }
export interface EvalCase { id: string; title: string; prompt: string; expected: string[]; status?: string; lastResult?: RunQuality; modeId?: string; form?: Record<string, string>; }
export interface AgentSession { _id: string; title: string; activeAgentId?: string; messages?: any[]; activeSkillId?: string; }
export interface Skill { id: string; name: string; version: string; description: string; systemPrompt: string; inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown>; allowedTools: string[]; knowledgeScopes: string[]; }
export interface ModelPreset { id: string; label: string; provider: string; model: string; description: string; configured: boolean; active?: boolean; }
export interface KnowledgeTemplate { id: string; title: string; description?: string; tags: string[]; }
export interface KnowledgeDocument { _id: string; title: string; tags?: string[]; chunkCount?: number; sourceType?: 'project-file' | 'upload' | 'template' | 'manual'; sourcePath?: string; sourceUpdatedAt?: string; createdAt?: string; }
export interface Approval { _id: string; status: 'pending' | 'confirmed' | 'revised' | 'rejected'; documentDraft: string; finalDocument?: string; reviewedAt?: string; }
export interface RuntimeStatus { llm: { provider: string; mode: string; model: string; configured: boolean; streaming?: boolean; protocol?: string }; rag: Record<string, any>; mcp: { enabled: boolean; transport: string; command: string }; }
export interface TraceStep { id: string; name: string; status: 'pending' | 'running' | 'success' | 'waiting' | 'failed' | 'paused' | 'cancelled' | 'review_required'; durationMs?: number; tokenUsage?: number; input?: unknown; output?: unknown; error?: string; tool?: string; humanRequired?: boolean; }
export interface RagSource { _id: string; documentTitle: string; content: string; score: number; tags?: string[]; chunkIndex?: number; retrievalBackend?: string; sourceType?: string; sourcePath?: string; }
export interface VectorStoreHealth { ok: boolean; live: boolean; message: string; status: any; checks: Record<string, any>; }