import { CheckCircle2, Copy, Eye, FileText } from 'lucide-react';
import type { AgentRun, Artifact } from '../types';

type ArtifactWorkbenchProps = {
    artifacts: Artifact[];
    activeArtifact?: Artifact;
    activeRun: AgentRun | null;
    artifactDraft: string;
    onArtifactDraftChange: (value: string) => void;
    onSelectArtifact: (artifact: Artifact) => void;
    onCopy: (text: string) => void;
    onSaveArtifact: () => void;
    onConfirmArtifact: () => void;
    onReviewArtifact: () => void;
    onExportArtifact: (format: 'markdown' | 'json') => void;
    readOnly?: boolean;
};

export function ArtifactWorkbench({
    artifacts,
    activeArtifact,
    activeRun,
    artifactDraft,
    onArtifactDraftChange,
    onSelectArtifact,
    onCopy,
    onSaveArtifact,
    onConfirmArtifact,
    onReviewArtifact,
    onExportArtifact,
    readOnly = false
}: ArtifactWorkbenchProps) {
    return (
        <section className="panel delivery-artifacts">
            <div className="section-head">
                <div>
                    <h2>Artifact 交付物总览</h2>
                    <p>把模型输出变成可预览、可复制、可确认、可导出的产品资产。</p>
                </div>
                <span>{artifacts.length} artifacts</span>
            </div>
            {readOnly ? <p className="delivery-readonly-hint">当前为受限演示账号：生成结果可查看，版本保存、导出、确认和送审已禁用。</p> : null}
            <div className="delivery-artifact-shell">
                <nav>
                    {artifacts.map((artifact) => (
                        <button key={artifact.id} className={activeArtifact?.id === artifact.id ? 'active' : ''} onClick={() => onSelectArtifact(artifact)}>
                            <FileText size={15} />
                            <strong>{artifact.title}</strong>
                            <span>{artifact.status} · {artifact.reviewStatus || 'pending'} · v{artifact.version || 1}</span>
                        </button>
                    ))}
                    {!artifacts.length ? <div className="runtime-empty">暂无交付物。</div> : null}
                </nav>
                <article>
                    {activeArtifact ? (
                        <>
                            <header>
                                <div>
                                    <strong>{activeArtifact.title}</strong>
                                    <span>trace: {activeArtifact.traceStepId || 'unknown'} · {activeArtifact.type}</span>
                                </div>
                                <div>
                                    <button className="secondary-button compact" onClick={() => onCopy(artifactDraft)}><Copy size={13} />复制</button>
                                    <button className="secondary-button compact" disabled={!activeRun || readOnly} title={readOnly ? '受限演示账号不可保存版本' : undefined} onClick={onSaveArtifact}>保存版本</button>
                                    <button className="secondary-button compact" disabled={!activeRun || readOnly} title={readOnly ? '受限演示账号不可导出' : undefined} onClick={() => onExportArtifact('markdown')}>导出 MD</button>
                                    <button className="secondary-button compact" disabled={!activeRun || readOnly} title={readOnly ? '受限演示账号不可导出' : undefined} onClick={() => onExportArtifact('json')}>导出 JSON</button>
                                    <button className="primary-button compact" disabled={!activeRun || readOnly} title={readOnly ? '受限演示账号不可确认' : undefined} onClick={onConfirmArtifact}><CheckCircle2 size={13} />确认</button>
                                    <button className="secondary-button compact" disabled={!activeRun || readOnly} title={readOnly ? '受限演示账号不可送审' : undefined} onClick={onReviewArtifact}><Eye size={13} />送审</button>
                                </div>
                            </header>
                            <div className="delivery-artifact-editor">
                                <textarea readOnly={readOnly} value={artifactDraft} onChange={(event) => onArtifactDraftChange(event.target.value)} />
                                <aside>
                                    <strong>版本与审批</strong>
                                    <span>Trace · {activeArtifact.generatedBy?.traceStepId || activeArtifact.traceStepId || 'unknown'}</span>
                                    <span>Tool · {activeArtifact.generatedBy?.tool || 'planDelivery'}</span>
                                    {activeArtifact.evalId ? <span>Eval · {activeArtifact.evalId}</span> : null}
                                    {(activeArtifact.sourceRefs || []).slice(0, 4).map((item) => (
                                        <span key={item.id}>[{item.index}] {item.title} · {Number(item.score || 0).toFixed(4)}</span>
                                    ))}
                                    {(activeArtifact.versions || []).slice(0, 5).map((item) => (
                                        <span key={`${item.version}-${item.createdAt}`}>v{item.version} · {item.status}</span>
                                    ))}
                                    {(activeArtifact.approvals || []).slice(0, 5).map((item, index) => (
                                        <span key={`${item.createdAt}-${index}`}>{item.action} · {item.note || '已确认'}</span>
                                    ))}
                                    {(activeArtifact.exports || []).slice(0, 5).map((item) => (
                                        <span key={item.id}>export · {item.format} · {item.filename}</span>
                                    ))}
                                    {!activeArtifact.versions?.length && !activeArtifact.approvals?.length ? <p>保存或确认后会产生真实版本和审批记录。</p> : null}
                                </aside>
                            </div>
                        </>
                    ) : (
                        <div className="runtime-empty">生成后选择左侧 Artifact 查看详情。</div>
                    )}
                </article>
            </div>
        </section>
    );
}
