import { AppEvents, eventBus } from './events';
import { invalidateAgentStudioBlueprint } from '../services/blueprintService';

export type RuntimeModelChangedPayload = {
  version: number;
  primary: {
    provider: string;
    model: string;
  };
  reason: 'publish' | 'rollback';
  origin: 'local' | 'broadcast';
  changedAt: string;
};

type BroadcastMessage = Omit<RuntimeModelChangedPayload, 'origin'> & {
  type: typeof AppEvents.RUNTIME_MODEL_SETTINGS_CHANGED;
  sourceId: string;
};

const CHANNEL_NAME = 'aidemo:runtime-model-settings:v1';
const sourceId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const channel = typeof window !== 'undefined' && 'BroadcastChannel' in window
  ? new BroadcastChannel(CHANNEL_NAME)
  : null;

function isBroadcastMessage(value: unknown): value is BroadcastMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BroadcastMessage>;
  return candidate.type === AppEvents.RUNTIME_MODEL_SETTINGS_CHANGED &&
    typeof candidate.sourceId === 'string' &&
    typeof candidate.version === 'number' &&
    typeof candidate.primary?.provider === 'string' &&
    typeof candidate.primary?.model === 'string' &&
    (candidate.reason === 'publish' || candidate.reason === 'rollback');
}

channel?.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!isBroadcastMessage(event.data) || event.data.sourceId === sourceId) return;
  const { type: _type, sourceId: _sourceId, ...payload } = event.data;
  invalidateAgentStudioBlueprint();
  eventBus.emit(AppEvents.RUNTIME_MODEL_SETTINGS_CHANGED, {
    ...payload,
    origin: 'broadcast'
  });
});

export function notifyRuntimeModelSettingsChanged(
  payload: Omit<RuntimeModelChangedPayload, 'origin' | 'changedAt'>
) {
  const changedAt = new Date().toISOString();
  invalidateAgentStudioBlueprint();
  eventBus.emit(AppEvents.RUNTIME_MODEL_SETTINGS_CHANGED, {
    ...payload,
    changedAt,
    origin: 'local'
  });
  channel?.postMessage({
    ...payload,
    type: AppEvents.RUNTIME_MODEL_SETTINGS_CHANGED,
    changedAt,
    sourceId
  } satisfies BroadcastMessage);
}

export function subscribeRuntimeModelSettingsChanged(
  handler: (payload: RuntimeModelChangedPayload) => void
) {
  return eventBus.on(AppEvents.RUNTIME_MODEL_SETTINGS_CHANGED, (payload) => {
    handler(payload as RuntimeModelChangedPayload);
  });
}
