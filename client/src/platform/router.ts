import { useEffect, useMemo, useState } from 'react';
import { eventBus, AppEvents } from './events';

export function pathToRoute(pathname: string) {
  const [, appId = 'copilot'] = pathname.split('/');
  return appId || 'copilot';
}

export function navigate(appId: string) {
  const next = `/${appId}`;
  if (window.location.pathname !== next) {
    window.history.pushState({ appId }, '', next);
  }
  eventBus.emit(AppEvents.ROUTE_CHANGED, { appId });
}

export function useShellRouter() {
  const [appId, setAppId] = useState(() => pathToRoute(window.location.pathname));

  useEffect(() => {
    const sync = () => setAppId(pathToRoute(window.location.pathname));
    const off = eventBus.on(AppEvents.ROUTE_CHANGED, ({ appId: next }) => setAppId(next));
    window.addEventListener('popstate', sync);
    return () => {
      off();
      window.removeEventListener('popstate', sync);
    };
  }, []);

  return useMemo(() => ({ appId, navigate }), [appId]);
}
