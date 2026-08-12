import type { RagRuntime, RetrievalView, Source } from './types';

export function stringify(content: unknown) {
  return typeof content === 'string' ? content : JSON.stringify(content, null, 2);
}

export function shortText(value = '', size = 150) {
  return value.length > size ? `${value.slice(0, size)}...` : value;
}

export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function isLiveVectorSource(source: Source) {
  return ['mongodb-atlas-vector-search', 'mongodb-atlas-hybrid-search', 'mongodb-atlas-full-text-search']
    .includes(source.retrievalBackend || '');
}

function isFallbackSource(source: Source) {
  const backend = source.retrievalBackend || '';
  return backend === 'local' || backend === 'local-hash' || backend.includes('fallback');
}

export function getRetrievalView(ragRuntime: RagRuntime | undefined, currentSources: Source[]): RetrievalView {
  const hasRunSources = currentSources.length > 0;
  const runLive = hasRunSources && currentSources.every(isLiveVectorSource);
  const runFallback = hasRunSources && currentSources.some(isFallbackSource);
  // 检索后端是否 live 应由向量索引/检索能力本身决定，不能用 productionReady 代理。
  // productionReady 是聚合状态(embedding + retrieval)， embedding fallback 时 retrieval 仍可能是 live。
  const configuredLive = Boolean(
    ragRuntime?.vectorSearchReady && ragRuntime?.retrievalBackend === 'mongodb-atlas-vector-search'
  );
  const embeddingFallback = Boolean(ragRuntime?.embeddingProvider?.startsWith('local-fallback'));
  const backend = hasRunSources
    ? (currentSources[0]?.retrievalBackend || 'unknown')
    : (ragRuntime?.retrievalBackend || ragRuntime?.backend || ragRuntime?.vectorStore || 'retrieval loading');

  return {
    live: hasRunSources ? runLive : configuredLive,
    backend,
    label: hasRunSources
      ? (runLive ? 'live vector store' : (runFallback ? 'fallback used by current run' : 'current run backend unknown'))
      : (configuredLive
          ? (embeddingFallback ? 'embedding fallback — not production ready' : 'live vector store ready')
          : 'fallback / not verified'),
    warning: hasRunSources && !runLive
      ? '本次 Run 的引用来自降级检索，Eval 不会按真实向量检索通过。'
      : (configuredLive && embeddingFallback
          ? 'Atlas $vectorSearch 已连通，但 embedding 走本地回退（未配置 API key）— not production ready。配置 DASHSCOPE_API_KEY / EMBEDDING_API_KEY 后恢复真实语义向量。'
          : '')
  };
}
