import { lazy } from 'react';
import {
  Bot,
  Code2,
  Database,
  GitBranch,
  Globe2,
  LineChart,
  Map,
  MessageSquareText,
  MonitorDot,
  Smartphone,
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
    id: 'overview',
    name: '平台总览',
    labelKey: 'nav.overview',
    icon: LineChart,
    domain: 'shell',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['route', 'event-bus', 'telemetry'],
    loader: lazy(() => import('../modules/overview/Overview'))
  },
  {
    id: 'terminals',
    name: '三端展业',
    labelKey: 'nav.terminals',
    icon: Smartphone,
    domain: 'terminal',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['pc', 'h5', 'wecom-miniapp', 'bridge'],
    loader: lazy(() => import('../modules/terminals/Terminals'))
  },
  {
    id: 'assistant',
    name: '企微 AI 助手',
    labelKey: 'nav.assistant',
    icon: Bot,
    domain: 'wecom-ai',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['sse', 'conversation-memory', 'rag-grounding'],
    loader: lazy(() => import('../modules/assistant/Assistant'))
  },
  {
    id: 'knowledge',
    name: '知识库 RAG',
    labelKey: 'nav.knowledge',
    icon: Database,
    domain: 'rag',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['embedding', 'retrieval', 'rerank', 'citation'],
    loader: lazy(() => import('../modules/knowledge/Knowledge'))
  },
  {
    id: 'spec',
    name: 'Spec Coding',
    labelKey: 'nav.spec',
    icon: Code2,
    domain: 'spec',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['spec-to-api', 'state-machine', 'review-checklist'],
    loader: lazy(() => import('../modules/spec/SpecCoding'))
  },
  {
    id: 'skills',
    name: 'AI Skill 编排',
    labelKey: 'nav.skills',
    icon: Sparkles,
    domain: 'ai-skill',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['tool-calling', 'permission', 'audit'],
    loader: lazy(() => import('../modules/skills/Skills'))
  },
  {
    id: 'annotation',
    name: '标注工作台',
    labelKey: 'nav.annotation',
    icon: Map,
    domain: 'annotation',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['pre-label', 'review-flow', 'map-visualization'],
    loader: lazy(() => import('../modules/annotation/Annotation'))
  },
  {
    id: 'flow-editor',
    name: '低码流程编辑器',
    labelKey: 'nav.flow-editor',
    icon: GitBranch,
    domain: 'workflow-core',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['document-model', 'schema', 'plugin', 'selection', 'history', 'command', 'offline-sync'],
    loader: lazy(() => import('../modules/flow-editor/FlowEditor'))
  },
  {
    id: 'i18n',
    name: '国际化治理',
    labelKey: 'nav.i18n',
    icon: Globe2,
    domain: 'platform-i18n',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['crowdin', 'nacos', 'runtime-cache', 'timezone', 'rtl', 'lint-coverage'],
    loader: lazy(() => import('../modules/i18n/I18nGovernance'))
  },
  {
    id: 'im',
    name: '在线 IM',
    labelKey: 'nav.im',
    icon: MessageSquareText,
    domain: 'client-im',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['websocket', 'robot', 'agent-handoff', 'conversation'],
    loader: lazy(() => import('../modules/im/IMCenter'))
  },
  {
    id: 'ops',
    name: '发布运维',
    labelKey: 'nav.ops',
    icon: MonitorDot,
    domain: 'ops',
    mode: 'local',
    sandbox: 'wujie',
    capabilities: ['gray-release', 'trace', 'incident-review'],
    loader: lazy(() => import('../modules/ops/Ops'))
  }
];

export function getSubApp(appId: string): SubAppManifest {
  return subApps.find((item) => item.id === appId) || subApps[0];
}
