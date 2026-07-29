import type { RefObject } from 'react';
import type { TraceStep } from '../types';
import { CitationText } from './CitationText';

type StreamPanelProps = {
  status: string;
  running: boolean;
  trace: TraceStep[];
  answer: string;
  sourceCount?: number;
  outputRef: RefObject<HTMLDivElement | null>;
};

const flowSteps = ['需求校验', 'RAG 检索', '工具产物', '流式总结', '人工确认'];

export function StreamPanel({ status, running, trace, answer, sourceCount = 0, outputRef }: StreamPanelProps) {
  return (
    <section className="panel delivery-stream">
      <div className="section-head">
        <div>
          <h2>流式分析过程</h2>
          <p>展示 AI 如何把需求拆解为上下文、计划和结论。</p>
        </div>
        <span className={`delivery-status ${status}`}>{running ? 'streaming' : status}</span>
      </div>
      <div className="delivery-flow-steps">
        {flowSteps.map((item, index) => (
          <article key={item} className={trace.length > index || running ? 'active' : ''}>
            <em>{String(index + 1).padStart(2, '0')}</em>
            <strong>{item}</strong>
          </article>
        ))}
      </div>
      <div className="delivery-output" ref={outputRef}>
        {answer ? <pre><CitationText text={answer} sourceCount={sourceCount} /></pre> : <div className="runtime-empty">点击生成后，这里会展示真实 SSE 流式分析过程。</div>}
      </div>
    </section>
  );
}
