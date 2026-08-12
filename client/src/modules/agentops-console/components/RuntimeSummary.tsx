import type { AgentRun, Blueprint, RagRuntime } from '../types';
import { formatTime } from '../utils';

type Props = {
  activeRun?: AgentRun;
  blueprint: Blueprint | null;
  ragRuntime?: RagRuntime;
  ragLive: boolean;
};

export function RuntimeSummary({ activeRun, blueprint, ragRuntime, ragLive }: Props) {
  const configuredModel = blueprint?.runtime.llm.model;
  const actualModel = String(activeRun?.provider?.requestedModel || activeRun?.provider?.model || '');
  const fallbackUsed = activeRun?.provider?.fallbackUsed === true;
  return (
    <section className="ops-runtime-summary panel">
      <div className="ops-runtime-title">
        <span>当前选中 Run</span>
        <h2>{activeRun?.intent?.label || '等待 Agent Run'}</h2>
        <p>{activeRun?.prompt || '从 Run Registry 选择真实运行，或创建新的限额 Run；这里不会展示静态伪造结果。'}</p>
      </div>
      <div className="ops-runtime-pills">
        <em>配置模型 {configuredModel || 'loading'} · {blueprint?.runtime.llm.provider || 'llm'}</em>
        <em className={fallbackUsed ? 'fallback' : actualModel ? 'live' : ''}>
          Run 实际模型 {actualModel || '尚未运行'}{fallbackUsed ? ' · fallback' : ''}
        </em>
        <em className={ragLive ? 'live' : 'fallback'}>
          {ragLive ? 'mongodb-atlas-vector-search live' : `${ragRuntime?.retrievalBackend || ragRuntime?.vectorStore || 'vector'} fallback`}
        </em>
        <em>{activeRun?.status || 'no-run'}</em>
        {activeRun ? <em>run {activeRun.runId} · {formatTime(activeRun.createdAt)}</em> : null}
      </div>
    </section>
  );
}
