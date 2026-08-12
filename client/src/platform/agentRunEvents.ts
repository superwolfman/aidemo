import { AppEvents, eventBus } from './events';

export type AgentRunChangedPayload = {
  tenantId: string;
  runDbId: string;
  runId?: string;
  reason: 'completed' | 'updated';
  origin: 'local' | 'broadcast';
  changedAt: string;
};

type BroadcastMessage = Omit<AgentRunChangedPayload, 'origin'> & {
  type: typeof AppEvents.AGENT_RUN_CHANGED;
  sourceId: string;
};

const sourceId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const channel = typeof window !== 'undefined' && 'BroadcastChannel' in window
  ? new BroadcastChannel('aidemo:agent-runs:v1')
  : null;

function isMessage(value: unknown): value is BroadcastMessage {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<BroadcastMessage>;
  return item.type === AppEvents.AGENT_RUN_CHANGED &&
    typeof item.sourceId === 'string' &&
    typeof item.tenantId === 'string' &&
    typeof item.runDbId === 'string';
}

channel?.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!isMessage(event.data) || event.data.sourceId === sourceId) return;
  const { type: _type, sourceId: _sourceId, ...payload } = event.data;
  eventBus.emit(AppEvents.AGENT_RUN_CHANGED, { ...payload, origin: 'broadcast' });
});

export function notifyAgentRunChanged(payload: Omit<AgentRunChangedPayload, 'origin' | 'changedAt'>) {
  const changedAt = new Date().toISOString();
  eventBus.emit(AppEvents.AGENT_RUN_CHANGED, { ...payload, changedAt, origin: 'local' });
  channel?.postMessage({
    ...payload,
    type: AppEvents.AGENT_RUN_CHANGED,
    changedAt,
    sourceId
  } satisfies BroadcastMessage);
}

export function subscribeAgentRunChanged(handler: (payload: AgentRunChangedPayload) => void) {
  return eventBus.on(AppEvents.AGENT_RUN_CHANGED, (payload) => handler(payload as AgentRunChangedPayload));
}
