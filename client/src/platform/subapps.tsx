import { lazy } from 'react';
import {
  Bot,
} from 'lucide-react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { LucideIcon } from 'lucide-react';

export type ShellContext = {
  user: any;
  eventBus: any;
  navigate: (appId: string) => void;
  app: SubAppManifest;
};

export type LocalSubApp = LazyExoticComponent<ComponentType<{ shell: ShellContext }>>;

export type SubAppManifest = {
  id: string;
  name: string;
  labelKey: string;
  icon: LucideIcon;
  domain: string;
  mode: 'local' | 'wujie';
  sandbox: 'wujie';
  entry?: string;
  capabilities: string[];
  loader: LocalSubApp;
};

export const subApps: SubAppManifest[] = [
  {
    id: 'copilot',
    name: 'AI Copilot',
    labelKey: 'nav.copilot',
    icon: Bot,
    domain: 'architecture-copilot',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['multi-session-chat', 'skill-runtime', 'tool-calling', 'rag', 'human-in-loop', 'agent-trace'],
    loader: lazy(() => import('../modules/copilot/CopilotWorkbench'))
  }
];

export function getSubApp(appId: string): SubAppManifest {
  return subApps.find((item) => item.id === appId) || subApps[0];
}
