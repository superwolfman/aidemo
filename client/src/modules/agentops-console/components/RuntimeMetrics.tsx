import { Database } from 'lucide-react';
import type { Blueprint, Capability, MetricTrends, RuntimeMetrics as RuntimeMetricsData } from '../types';
import { scopeOptions } from '../utils';
import { MetricTrendCard } from './Common';

type RetrievalView = {
  backend: string;
  label: string;
  message: string;
};

type Props = {
  metrics: RuntimeMetricsData;
  traceCount: number;
  metricTrends: MetricTrends;
  blueprint: Blueprint | null;
  selectedAgent?: Capability;
  selectedScopeLabels: string[];
  retrievalView: RetrievalView;
  ragRuntime?: Blueprint['runtime']['rag'];
  ragLive: boolean;
  onOpenDetail: () => void;
};

export function MetricsGrid({ metrics }: { metrics: RuntimeMetricsData }) {
  return (
    <section className="ops-metrics-grid">
      <article><strong>{metrics.total}</strong><span>Total Runs</span></article>
      <article><strong>{metrics.waiting}</strong><span>Waiting Review</span></article>
      <article><strong>{metrics.failed}</strong><span>Failed</span></article>
      <article><strong>{metrics.avgLatency}ms</strong><span>Avg Latency</span></article>
      <article><strong>{metrics.avgQuality}%</strong><span>Quality</span></article>
    </section>
  );
}

export function RuntimeMetrics({
  metrics,
  traceCount,
  metricTrends,
  blueprint,
  selectedAgent,
  selectedScopeLabels,
  retrievalView,
  ragRuntime,
  ragLive,
  onOpenDetail
}: Props) {
  return (
    <section className="ops-runtime-metrics-panel panel">
      <div className="section-head">
        <div>
          <h2>Runtime Metrics</h2>
          <p>基于真实 Run、Trace 和日志聚合，不使用静态 Mock 指标。</p>
        </div>
        <button className="secondary-button compact" type="button" onClick={onOpenDetail}>
          打开 Run Detail
        </button>
      </div>
      <div className="ops-runtime-metric-grid">
        <MetricTrendCard label="Latency Trend" value={`${metrics.avgLatency}ms`} desc={`${metrics.total} runs · ${traceCount} current trace events`} path={metricTrends.latency} />
        <MetricTrendCard label="Token Usage" value={metrics.tokens.toLocaleString('en-US')} desc="Aggregated from trace tokenUsage" path={metricTrends.tokens} tone="blue" />
        <MetricTrendCard label="Run Quality" value={metrics.assessed ? `${metrics.avgQuality}%` : '未评估'} desc={`${metrics.assessed}/${metrics.total} runs have quality score`} path={metricTrends.quality} tone="cyan" />
        <article className="ops-metric-baseline-card">
          <span>Ops Baseline</span>
          <strong>{Math.min(metrics.total, 12)} samples</strong>
          <p>等待审批 {metrics.waiting} 个，失败 {metrics.failed} 个，已确认 {metrics.confirmed} 个。</p>
        </article>
      </div>
      <div className="ops-runtime-context-strip">
        <span><Database size={13} />LLM {blueprint?.runtime.llm.provider || 'loading'} · {blueprint?.runtime.llm.mode || 'unknown'} · {blueprint?.runtime.llm.model || 'model loading'}</span>
        <span>Vector {retrievalView.backend} · {retrievalView.label} · {ragRuntime?.index || 'index pending'}</span>
        <span>{ragLive ? `Live ${ragRuntime?.vectorPath || 'embedding'} · ${ragRuntime?.dimensions || 0} dims` : (retrievalView.message || ragRuntime?.error || 'fallback retrieval')}</span>
        <span>新建 Run Agent {selectedAgent?.name || 'Agent Runtime'}</span>
        <span>Scope {selectedScopeLabels.length}/{scopeOptions.length} · {selectedScopeLabels.join(' / ') || 'minimal context'}</span>
      </div>
    </section>
  );
}
