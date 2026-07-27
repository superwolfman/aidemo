import { useState } from 'react';
import type { TraceStep } from '../types';

type Props = {
    trace: TraceStep[];
    status: string;
};

function formatPayload(payload: unknown) {
    if (!payload) return '无结构化输入/输出';
    if (typeof payload === 'string') return payload;
    try {
        return JSON.stringify(payload, null, 2);
    } catch {
        return String(payload);
    }
}

export function TraceTimeline({ trace, status }: Props) {
    const [allOpen, setAllOpen] = useState(false)
    return (
        <section className="delivery-trace-timeline panel">
            <div className="section-head">
                <div>
                    <h3>Trace Timeline</h3>
                    {/* <p>默认展示 Agent 执行路径，展开后可审计每一步输入、输出、耗时和 token。</p> */}
                    <p>默认收起，点击节点或“展开全部”查看详情。</p>
                </div>
                <div className="delivery-trace-actions">
                    <button
                        type="button"
                        className="secondary-button"
                        onClick={() => setAllOpen(v => !v)}
                    >
                        {allOpen ? '收起全部' : '展开全部'}
                    </button>
                    <span className={`status-pill ${status}`}>{status}</span>
                </div>
            </div>
            <div className="delivery-trace-list">
                {trace.map((item, index) => (
                    <details key={`${item.id} -${index} `} className={`delivery-trace-item ${item.status} `} open={allOpen}>
                        <summary>
                            <span>{String(index + 1).padStart(2, '0')}</span>
                            <strong>{item.name}</strong>
                            <em>{item.status}</em>
                            <small>{item.durationMs || 0}ms · {item.tokenUsage || 0} tokens</small>
                        </summary>
                        <div className="delivery-trace-detail">
                            <article>
                                <b>input</b>
                                <pre>{formatPayload(item.input)}</pre>
                            </article>
                            <article>
                                <b>output</b>
                                <pre>{formatPayload(item.output || item.error)}</pre>
                            </article>
                        </div>
                    </details>
                ))}
                {!trace.length ? <div className="runtime-empty">运行后展示真实 Trace 节点。</div> : null}
            </div>
        </section>
    );
}
