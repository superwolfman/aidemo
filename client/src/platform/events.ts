export const AppEvents = {
  ROUTE_CHANGED: 'shell:route-changed',
  SUBAPP_MOUNTED: 'shell:subapp-mounted',
  SUBAPP_UNMOUNTED: 'shell:subapp-unmounted',
  AUTH_LOGOUT: 'auth:logout',
  ASSISTANT_ASKED: 'assistant:asked',
  KNOWLEDGE_DOCUMENT_CREATED: 'knowledge:document-created',
  SPEC_GENERATED: 'spec:generated',
  SKILL_RUN_COMPLETED: 'skill:run-completed',
  AGENT_RUN_CHANGED: 'agent:run-changed',
  RUNTIME_MODEL_SETTINGS_CHANGED: 'runtime:model-settings-changed',
  FLOW_NODE_SELECTED: 'flow:node-selected',
  FLOW_COMMAND_EXECUTED: 'flow:command-executed',
  TELEMETRY_EVENT: 'telemetry:event'
} as const;

export type AppEventName = (typeof AppEvents)[keyof typeof AppEvents];

export type EventBus = {
  emit: (type: AppEventName, payload?: Record<string, unknown>) => void;
  on: (type: AppEventName, handler: (payload: any, detail: { payload: any; at: number }) => void) => () => void;
};

export function createEventBus(): EventBus {
  const target = new EventTarget();

  return {
    emit(type, payload = {}) {
      target.dispatchEvent(new CustomEvent(type, { detail: { payload, at: Date.now() } }));
      target.dispatchEvent(new CustomEvent(AppEvents.TELEMETRY_EVENT, { detail: { payload: { type, payload }, at: Date.now() } }));
    },
    on(type, handler) {
      const wrapped = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        handler(detail?.payload, detail);
      };
      target.addEventListener(type, wrapped);
      return () => target.removeEventListener(type, wrapped);
    }
  };
}

export const eventBus = createEventBus();

declare global {
  interface Window {
    __ENABLEMENT_EVENT_BUS__?: EventBus;
  }
}

window.__ENABLEMENT_EVENT_BUS__ = eventBus;
