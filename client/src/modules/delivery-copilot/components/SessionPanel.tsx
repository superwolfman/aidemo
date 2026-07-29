import type { RagRuntime, RunQuality, RuntimeBlueprint } from '../types';

type Props = {
    blueprint: RuntimeBlueprint | null;
    ragRuntime?: RagRuntime;
    ragLive: boolean;
    quality: RunQuality | null;
};

export function SessionPanel({ blueprint, ragRuntime, ragLive, quality }: Props) {
    const llm = blueprint?.runtime.llm;
    return (
        <section className="delivery-hero panel">
            <div>
                <span>Product Delivery Flow</span>
                <h2>需求到产物的 AI 工作流</h2>
                {/* <p>这里不是运行监控，而是业务交付工作区。用户输入目标，系统检索知识库，流式分析并产出可评审交付物。</p> */}
            </div>
            <div className="delivery-hero-metrics">
                <article>
                    <strong>{llm?.provider || 'runtime'}</strong>
                    <span>{llm?.mode || 'loading'} · {llm?.model || 'model'}</span>
                </article>
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
                            {quality.capabilities.realVector ? 'Atlas' : 'fallback'} · {quality.capabilities.realProvider ? 'live' : 'mock'}
                        </small>
                    ) : null}
                </article>
            </div>
        </section>
    );
}
