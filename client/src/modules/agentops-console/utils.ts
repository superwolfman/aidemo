import type { RagRuntime, RunSource } from './types';

export function formatJson(value: unknown) {
  return JSON.stringify(value ?? null, null, 2);
}

export function formatTime(value?: string) {
  if (!value) return '--:--:--';
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function buildSparkline(values: number[]) {
  if (!values.length) return '';
  const width = 280;
  const height = 72;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  return values.map((value, index) => {
    const x = Math.round(index * step);
    const y = Math.round(height - (value / max) * 58 - 7);
    return `${x},${y}`;
  }).join(' ');
}

export function isLiveVectorSource(source: RunSource) {
  return source.retrievalBackend === 'mongodb-atlas-vector-search';
}

export function isFallbackSource(source: RunSource) {
  const backend = source.retrievalBackend || '';
  return backend === 'local' || backend === 'local-hash' || backend.includes('fallback');
}

export function getRunRetrievalView(ragRuntime: RagRuntime | undefined, currentSources: RunSource[] = []) {
  const hasRunSources = currentSources.length > 0;
  const runLive = hasRunSources && currentSources.every(isLiveVectorSource);
  const runFallback = hasRunSources && currentSources.some(isFallbackSource);
  const configuredLive = Boolean(ragRuntime?.productionReady && ragRuntime?.retrievalBackend === 'mongodb-atlas-vector-search');
  const backend = hasRunSources
    ? (currentSources[0]?.retrievalBackend || 'unknown')
    : (ragRuntime?.retrievalBackend || ragRuntime?.backend || ragRuntime?.vectorStore || 'retrieval loading');

  return {
    live: hasRunSources ? runLive : configuredLive,
    backend,
    label: hasRunSources
      ? (runLive ? 'current run live vector' : (runFallback ? 'current run fallback retrieval' : 'current run backend unknown'))
      : (configuredLive ? 'live vector configured' : 'fallback / not verified'),
    message: hasRunSources && !runLive
      ? '当前选中 Run 使用降级检索，审计视图不会把它标记为真实向量链路。'
      : ''
  };
}

export const scopeOptions = [
  { id: 'architecture', label: '架构规范' },
  { id: 'standards', label: '研发规范' },
  { id: 'ai-native', label: 'AI Native' },
  { id: 'frontend', label: '前端交互' },
  { id: 'im', label: 'IM / 会话' },
  { id: 'sdk', label: 'SDK / 质量' }
];

export const stateOrder = [
  { id: 'intent', label: '意图理解' },
  { id: 'skill', label: 'Skill 自动选择' },
  { id: 'rag', label: 'RAG 上下文检索' },
  { id: 'tool', label: '工具 / 计划执行' },
  { id: 'llm', label: 'LLM 流式生成' },
  { id: 'review', label: '人工审批' }
];
