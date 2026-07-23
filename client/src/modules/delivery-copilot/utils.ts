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
  return source.retrievalBackend === 'mongodb-atlas-vector-search';
}

function isFallbackSource(source: Source) {
  const backend = source.retrievalBackend || '';
  return backend === 'local' || backend === 'local-hash' || backend.includes('fallback');
}

export function getRetrievalView(ragRuntime: RagRuntime | undefined, currentSources: Source[]): RetrievalView {
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
      ? (runLive ? 'live vector store' : (runFallback ? 'fallback used by current run' : 'current run backend unknown'))
      : (configuredLive ? 'live vector store ready' : 'fallback / not verified'),
    warning: hasRunSources && !runLive
      ? '本次 Run 的引用来自降级检索，Eval 不会按真实向量检索通过。'
      : ''
  };
}
