import { Suspense, useEffect } from 'react';
import WujieReact from 'wujie-react';
import { LoadingPanel } from '../components/ui';
import { AppEvents, eventBus } from './events';
import type { ShellContext, SubAppManifest } from './subapps';
import type { ComponentType } from 'react';

type Props = {
  app: SubAppManifest;
  context: ShellContext;
};

const WujieApp = WujieReact as unknown as ComponentType<{
  name: string;
  url: string;
  sync?: boolean;
  alive?: boolean;
  width?: string;
  height?: string;
  props?: Record<string, unknown>;
}>;

export function MicroAppContainer({ app, context }: Props) {
  const Component = app.loader;

  useEffect(() => {
    eventBus.emit(AppEvents.SUBAPP_MOUNTED, { appId: app.id, domain: app.domain, sandbox: app.sandbox });
    return () => eventBus.emit(AppEvents.SUBAPP_UNMOUNTED, { appId: app.id, domain: app.domain, sandbox: app.sandbox });
  }, [app.id, app.domain, app.sandbox]);

  if (app.mode === 'wujie' && app.entry) {
    return (
      <WujieApp
        name={app.id}
        url={app.entry}
        sync
        alive
        width="100%"
        height="100%"
        props={{
          shell: context,
          eventBus,
          parentWindow: window
        }}
      />
    );
  }

  return (
    <Suspense fallback={<LoadingPanel />}>
      <Component shell={context} />
    </Suspense>
  );
}
