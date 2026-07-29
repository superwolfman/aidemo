import type { AgentRun, Blueprint } from '../types';
import { formatJson, formatTime } from '../utils';

type DetailTab = 'overview' | 'trace' | 'artifacts' | 'sources' | 'raw'

type Props = {
    open: boolean;
    activeRun?: AgentRun;
    blueprint: Blueprint | null;
    detailTab: DetailTab;
    onTabChange: (tab: DetailTab) => void;
    onClose: () => void;
};

export function RunDetailDrawer({ open, activeRun, blueprint, detailTab, onTabChange, onClose }: Props) {
    return (
        <div className={`agentops-drawer-mask ${open ? 'open' : ''}`} onMouseDown={onClose}>
            <aside className="agentops-run-drawer" onMouseDown={(event) => event.stopPropagation()}>
                <header>
                    <div>
                        <span>RUN DETAIL</span>
                        <h2>{activeRun?.intent?.label || 'Agent Run Detail'}</h2>
                        <p>{activeRun?.prompt || '选择一个 Run 后可以查看完整状态流转、Trace、Artifact、审批和质量评分。'}</p>
                    </div>
                    <button className="secondary-button compact" type="button" onClick={onClose}>关闭</button>
                </header>
                <div className="agentops-drawer-tabs">
                    <button key="overview" type="button" data-tab="overview" className={detailTab === 'overview' ? 'active' : ''} onClick={() => onTabChange('overview')}>概览</button>
                    <button key="trace" type="button" data-tab="trace" className={detailTab === 'trace' ? 'active' : ''} onClick={() => onTabChange('trace')}>Trace</button>
                    <button key="artifacts" type="button" data-tab="artifacts" className={detailTab === 'artifacts' ? 'active' : ''} onClick={() => onTabChange('artifacts')}>Artifacts</button>
                    <button key="sources" type="button" data-tab="sources" className={detailTab === 'sources' ? 'active' : ''} onClick={() => onTabChange('sources')}>Sources</button>
                    <button key="raw" type="button" data-tab="raw" className={detailTab === 'raw' ? 'active' : ''} onClick={() => onTabChange('raw')}>Raw</button>
                </div>

                {detailTab === 'overview' ? (
                    <>
                        <div className="agentops-drawer-grid">
                            <article>
                                <span>Status</span>
                                <strong>{activeRun?.status || 'no-run'}</strong>
                                <p>{activeRun?.intent?.goal || '暂无运行目标。'}</p>
                            </article>
                            <article>
                                <span>Quality</span>
                                <strong>{activeRun?.quality ? `${activeRun.quality.score}%` : 'pending'}</strong>
                                <p>{activeRun?.quality ? `${activeRun.quality.passed}/${activeRun.quality.total} checks · ${activeRun.quality.verdict}` : '运行完成后写入质量评分。'}</p>
                            </article>
                            <article>
                                <span>Runtime</span>
                                <strong>{String(activeRun?.provider?.provider || blueprint?.runtime.llm.provider || 'LLM')}</strong>
                                <p>{String(activeRun?.provider?.mode || blueprint?.runtime.llm.mode || 'unknown')} · {String(activeRun?.provider?.model || blueprint?.runtime.llm.model || 'model')}</p>
                            </article>
                            <article>
                                <span>Evidence</span>
                                <strong>{activeRun?.sources?.length || 0} sources</strong>
                                <p>{activeRun?.artifacts?.length || 0} artifacts · {activeRun?.trace?.length || 0} trace events</p>
                            </article>
                        </div>
                        <div className="agentops-drawer-trace">
                            {(activeRun?.stateTransitions || []).map((transition) => (
                                <article key={transition.id}>
                                    <header>
                                        <strong>{transition.from} {'->'} {transition.to}</strong>
                                        <span>{formatTime(transition.at)}</span>
                                    </header>
                                    <p>{transition.label}{transition.reason ? ` · ${transition.reason}` : ''}</p>
                                </article>
                            ))}
                            {(activeRun?.quality?.checks || []).map((check) => (
                                <article key={check.key}>
                                    <header>
                                        <strong>{check.label}</strong>
                                        <span>{check.passed ? 'passed' : 'failed'}</span>
                                    </header>
                                    <p>{check.value}</p>
                                </article>
                            ))}
                        </div>
                    </>
                ) : null}

                {detailTab === 'trace' ? (
                    <div className="agentops-drawer-trace">
                        {(activeRun?.trace || []).map((item) => (
                            <article key={item.id}>
                                <header>
                                    <strong>{item.name}</strong>
                                    <span>{item.status} · {item.durationMs || 0}ms · {item.tokenUsage || 0} tokens</span>
                                </header>
                                <pre>{formatJson({ input: item.input, output: item.output, error: item.error, tool: item.tool })}</pre>
                            </article>
                        ))}
                    </div>
                ) : null}

                {detailTab === 'artifacts' ? (
                    <div className="agentops-drawer-artifacts">
                        {(activeRun?.artifacts || []).map((artifact) => (
                            <article key={artifact.id}>
                                <header>
                                    <strong>{artifact.title}</strong>
                                    <span>{artifact.type} · {artifact.status} · v{artifact.version || 1}</span>
                                </header>
                                <div className="agentops-drawer-grid">
                                    <article>
                                        <span>Trace</span>
                                        <strong>{artifact.traceStepId || 'unknown'}</strong>
                                        <p>{artifact.reviewStatus || 'pending'}</p>
                                    </article>
                                    <article>
                                        <span>Citations</span>
                                        <strong>{artifact.sourceRefs?.length || 0}</strong>
                                        <p>{(artifact.sourceRefs || []).slice(0, 3).map((source) => `[${source.index}] ${source.title}`).join(' / ') || 'no source refs'}</p>
                                    </article>
                                    <article>
                                        <span>Versions</span>
                                        <strong>{artifact.versions?.length || 0}</strong>
                                        <p>{(artifact.versions || []).slice(0, 3).map((item) => `v${item.version} ${item.status}`).join(' / ') || 'no version history'}</p>
                                    </article>
                                    <article>
                                        <span>Approvals / Exports</span>
                                        <strong>{(artifact.approvals?.length || 0) + (artifact.exports?.length || 0)}</strong>
                                        <p>{artifact.exports?.[0]?.filename || artifact.approvals?.[0]?.note || 'no operation history'}</p>
                                    </article>
                                </div>
                            </article>
                        ))}
                    </div>
                ) : null}
                {detailTab === 'sources' ? (
                    <div className="agentops-drawer-sources">
                        {(activeRun?.sources || []).map((source, i) => (
                            <article key={source._id || i}>
                                <header>
                                    <strong>[{i + 1}] {source.documentTitle}</strong>
                                    <span>score {Number(source.score || 0).toFixed(4)}</span>
                                </header>
                                <p>{source.content?.slice(0, 200)}</p>
                                <footer>
                                    <span>{source.retrievalBackend || 'unknown-backend'}</span>
                                </footer>
                            </article>
                        ))}
                        {!activeRun?.sources?.length ? (
                            <div className="runtime-empty">该 Run 暂无关联检索来源。</div>
                        ) : null}
                    </div>
                ) : null}

                {detailTab === 'raw' ? <pre className="agentops-drawer-raw">{formatJson(activeRun)}</pre> : null}
            </aside>
        </div>
    );
}
