import type { AgentRun, RagRuntime, RunQuality, RuntimeBlueprint } from '../types';

type Props = {
    blueprint: RuntimeBlueprint | null;
    activeRun: AgentRun | null;
    ragRuntime?: RagRuntime;
    ragLive: boolean;
    quality: RunQuality | null;
};

export function SessionPanel({ blueprint, activeRun, ragRuntime, ragLive, quality }: Props) {
    const llm = blueprint?.runtime.llm;
    const runProvider = activeRun?.provider;
    const actualModel = runProvider?.requestedModel || runProvider?.model;
    return (
        <section className="delivery-hero panel">
            <div>
                <span>Product Delivery Flow</span>
                <h2>需求到产物的 AI 工作流</h2>
                {/* <p>这里不是运行监控，而是业务交付工作区。用户输入目标，系统检索知识库，流式分析并产出可评审交付物。</p> */}
            </div>
            <div className="delivery-hero-metrics">
                <article>
                    <strong>当前配置模型</strong>
                    <span>{llm?.model || 'loading'}</span>
                    <small>{llm?.provider || 'runtime'} · {llm?.mode || 'loading'}</small>
                </article>
                {actualModel ? (
                    <article className={runProvider?.fallbackUsed ? 'warning' : 'live'}>
                        <strong>本次 Run 实际模型</strong>
                        <span>{actualModel}</span>
                        <small>{runProvider?.provider || 'runtime'} · {runProvider?.fallbackUsed ? `备用模型（主模型 ${runProvider.primaryModel || 'unknown'}）` : '主模型'}</small>
                    </article>
                ) : null}
                <article className={ragLive ? 'live' : 'warning'}>
                    <strong>{ragLive ? 'live vector store' : 'fallback retrieval'}</strong>
                    <span>{ragRuntime?.retrievalBackend || ragRuntime?.backend || 'loading'} · {ragRuntime?.index || 'chunks_vector_index'}</span>
                    {ragRuntime?.embeddingProvider ? (
                        <small className={ragRuntime.embeddingProvider.startsWith('local-fallback') ? 'env-warn' : 'env-ok'}>
                            embedding: {ragRuntime.embeddingProvider}
                        </small>
                    ) : null}
                </article>
                <article>
                    <strong>{quality ? `${quality.score}%` : 'pending'}</strong>
                    <span>quality</span>
                    {quality?.capabilities ? (
                        <small className={quality.capabilities.realVector && quality.capabilities.realProvider ? 'env-ok' : 'env-warn'}>
                            {quality.capabilities.realVector ? 'RAG Atlas' : (quality.citationHitCount ? 'RAG fallback' : 'RAG 未命中')} · {quality.capabilities.realProvider ? 'LLM live' : 'LLM mock'}
                        </small>
                    ) : null}
                </article>
            </div>
        </section>
    );
}
