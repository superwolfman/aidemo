import type { AgentRun, Blueprint, RagRuntime } from '../types';

type Props = {
  activeRun?: AgentRun;
  blueprint: Blueprint | null;
  ragRuntime?: RagRuntime;
  ragLive: boolean;
};

export function RuntimeSummary({ activeRun, blueprint, ragRuntime, ragLive }: Props) {
  return (
    <section className="ops-runtime-summary panel">
      <div className="ops-runtime-title">
        <span>Current Run</span>
        <h2>{activeRun?.intent?.label || '等待 Agent Run'}</h2>
        <p>{activeRun?.prompt || '这里不负责生产内容，而负责解释 Agent 怎么跑、哪里失败、能否恢复。'}</p>
      </div>
      <div className="ops-runtime-pills">
        <em>{blueprint?.runtime.llm.provider || 'llm'} · {blueprint?.runtime.llm.mode || 'loading'}</em>
        <em className={ragLive ? 'live' : 'fallback'}>
          {ragLive ? 'mongodb-atlas-vector-search live' : `${ragRuntime?.retrievalBackend || ragRuntime?.vectorStore || 'vector'} fallback`}
        </em>
        <em>{activeRun?.status || 'no-run'}</em>
      </div>
    </section>
  );
}
