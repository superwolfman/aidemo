import { lazy } from 'react';
import {
  Activity,
  Bot,
  Boxes,
  Workflow,
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
  visible?: boolean;
  group?: 'product' | 'debug';
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
    visible: false,
    group: 'debug',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['multi-session-chat', 'skill-runtime', 'tool-calling', 'rag', 'human-in-loop', 'agent-trace'],
    loader: lazy(() => import('../modules/copilot/CopilotWorkbench'))
  },
  {
    id: 'agent-studio',
    name: 'Agent Runtime',
    labelKey: 'nav.agentStudio',
    icon: Workflow,
    domain: 'agent-runtime',
    visible: false,
    group: 'debug',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['intent-routing', 'agent-plan', 'state-machine', 'tool-audit', 'pause-resume-rollback', 'human-in-loop'],
    loader: lazy(() => import('../modules/agent-studio/AgentStudio'))
  },
  {
    id: 'delivery-copilot',
    name: 'Delivery Copilot',
    labelKey: 'nav.deliveryCopilot',
    icon: Boxes,
    domain: 'delivery-copilot',
    visible: true,
    group: 'product',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['requirement-intake', 'rag-context', 'streaming-analysis', 'artifact-workbench', 'human-review'],
    loader: lazy(() => import('../modules/delivery-copilot/DeliveryCopilot'))
  },
  {
    id: 'agentops-console',
    name: 'AgentOps Console',
    labelKey: 'nav.agentOpsConsole',
    icon: Activity,
    domain: 'agentops-console',
    visible: true,
    group: 'product',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['run-registry', 'state-machine', 'trace-timeline', 'tool-audit', 'approval-history', 'failure-replay'],
    loader: lazy(() => import('../modules/agentops-console/AgentOpsConsole'))
  }
];

export function getSubApp(appId: string): SubAppManifest {
  return subApps.find((item) => item.id === appId) || subApps.find((item) => item.visible !== false) || subApps[0];
}

export const visibleSubApps = subApps.filter((item) => item.visible !== false);
