import { lazy } from 'react';
import {
  Bot,
  Database,
  Globe2,
  GitPullRequestArrow,
  ListChecks,
  Route,
  Sparkles
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
  },
  {
    id: 'skills',
    name: 'Skill 系统',
    labelKey: 'nav.skills',
    icon: Sparkles,
    domain: 'skill-runtime',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['input-schema', 'output-schema', 'allowed-tools', 'knowledge-scopes', 'versioning'],
    loader: lazy(() => import('../modules/copilot/CopilotWorkbench'))
  },
  {
    id: 'knowledge',
    name: 'RAG 知识库',
    labelKey: 'nav.knowledge',
    icon: Database,
    domain: 'architecture-rag',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['markdown', 'txt', 'pdf', 'chunking', 'vector-search', 'citations'],
    loader: lazy(() => import('../modules/copilot/CopilotWorkbench'))
  },
  {
    id: 'trace',
    name: 'Agent Trace',
    labelKey: 'nav.trace',
    icon: Route,
    domain: 'agent-trace',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['tool-input-output', 'token-usage', 'latency', 'human-confirmation'],
    loader: lazy(() => import('../modules/copilot/CopilotWorkbench'))
  },
  {
    id: 'review',
    name: '人工确认',
    labelKey: 'nav.review',
    icon: ListChecks,
    domain: 'human-in-loop',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['confirm', 'revise', 'reject', 'resume'],
    loader: lazy(() => import('../modules/copilot/CopilotWorkbench'))
  },
  {
    id: 'docs',
    name: '接入文档',
    labelKey: 'nav.docs',
    icon: GitPullRequestArrow,
    domain: 'docs',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['architecture', 'constraints', 'onboarding'],
    loader: lazy(() => import('../modules/copilot/CopilotWorkbench'))
  },
  {
    id: 'i18n',
    name: '国际化治理',
    labelKey: 'nav.i18n',
    icon: Globe2,
    domain: 'platform-i18n',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['runtime-cache', 'rtl', 'lint-coverage'],
    loader: lazy(() => import('../modules/i18n/I18nGovernance'))
  }
];

export function getSubApp(appId: string): SubAppManifest {
  return subApps.find((item) => item.id === appId) || subApps[0];
}
