import { ArrowDown, ArrowUp, CheckCircle2, History, PlayCircle, RotateCcw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../../api/client';
import { notifyRuntimeModelSettingsChanged } from '../../../platform/runtimeModelEvents';
import {
    getRuntimeModelSettings,
    publishRuntimeModelSettings,
    rollbackRuntimeModelSettings,
    testRuntimeModel,
    type RuntimeModelCatalogItem,
    type RuntimeModelRef,
    type RuntimeModelSettingsResponse
} from '../../../services/runtimeModelSettingsService';

const purposeLabels: Record<string, string> = {
    general: '通用生成',
    reasoning: '推理',
    'long-context': '长上下文',
    preview: '预览版',
    vision: '视觉',
    math: '数学',
    code: '代码',
    ocr: 'OCR',
    translation: '翻译',
    character: '角色扮演'
};

function modelKey(value: RuntimeModelRef) {
    return `${value.provider}:${value.model}`;
}

function formatDate(value?: string) {
    if (!value) return '-';
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export function ModelSettingsPanel() {
    const [data, setData] = useState<RuntimeModelSettingsResponse | null>(null);
    const [primaryKey, setPrimaryKey] = useState('');
    const [fallbackKeys, setFallbackKeys] = useState<string[]>([]);
    const [fallbackCandidate, setFallbackCandidate] = useState('');
    const [changeNote, setChangeNote] = useState('');
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const hydrate = useCallback((result: RuntimeModelSettingsResponse) => {
        setData(result);
        setPrimaryKey(modelKey(result.setting.primary));
        setFallbackKeys(result.setting.fallbackChain.map(modelKey));
    }, []);

    const load = useCallback(async () => {
        setBusy('load');
        try { hydrate(await getRuntimeModelSettings()); }
        catch (error) { setMessage({ type: 'error', text: error instanceof Error ? error.message : '加载模型设置失败' }); }
        finally { setBusy(''); }
    }, [hydrate]);

    useEffect(() => { void load(); }, [load]);

    const byKey = useMemo(() => new Map((data?.catalog || []).map((item) => [modelKey(item), item])), [data]);
    const eligible = useMemo(() => (data?.catalog || []).filter((item) => item.deliveryEligible), [data]);
    const availableFallbacks = eligible.filter((item) => {
        const key = modelKey(item);
        return item.credentialConfigured && key !== primaryKey && !fallbackKeys.includes(key);
    });
    const dirty = Boolean(data) && (
        primaryKey !== modelKey(data!.setting.primary) ||
        fallbackKeys.join('|') !== data!.setting.fallbackChain.map(modelKey).join('|')
    );

    function refFor(key: string): RuntimeModelRef {
        const item = byKey.get(key);
        return { provider: item?.provider || '', model: item?.model || '' };
    }

    function moveFallback(index: number, delta: number) {
        const nextIndex = index + delta;
        if (nextIndex < 0 || nextIndex >= fallbackKeys.length) return;
        setFallbackKeys((items) => {
            const next = [...items];
            [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
            return next;
        });
    }

    async function testConnection() {
        setBusy('test');
        setMessage(null);
        try {
            const result = await testRuntimeModel(refFor(primaryKey));
            setMessage({ type: 'success', text: `连接成功：${result.model}，${result.latencyMs}ms；凭据来自服务端密钥。` });
        } catch (error) {
            setMessage({ type: 'error', text: error instanceof Error ? error.message : '模型连接测试失败' });
        } finally { setBusy(''); }
    }

    async function publish() {
        if (!data) return;
        setBusy('publish');
        setMessage(null);
        try {
            const result = await publishRuntimeModelSettings({
                primary: refFor(primaryKey),
                fallbackChain: fallbackKeys.map(refFor),
                expectedVersion: data.setting.version,
                changeNote
            });
            hydrate(result);
            setChangeNote('');
            setMessage({ type: 'success', text: `v${result.setting.version} 已发布，所有新请求即时生效，无需重启服务。` });
            notifyRuntimeModelSettingsChanged({
                version: result.setting.version,
                primary: result.setting.primary,
                reason: 'publish'
            });
        } catch (error) {
            const text = error instanceof ApiError && error.status === 409
                ? '配置已被其他管理员更新，请刷新后重新确认。'
                : (error instanceof Error ? error.message : '发布失败');
            setMessage({ type: 'error', text });
        } finally { setBusy(''); }
    }

    async function rollback(targetVersion: number) {
        if (!data || !window.confirm(`确认把模型路由恢复为 v${targetVersion} 的配置？系统会创建一个新的审计版本。`)) return;
        setBusy(`rollback-${targetVersion}`);
        setMessage(null);
        try {
            const result = await rollbackRuntimeModelSettings({
                targetVersion,
                expectedVersion: data.setting.version,
                changeNote: `管理员一键回滚到 v${targetVersion}`
            });
            hydrate(result);
            setMessage({ type: 'success', text: `已基于 v${targetVersion} 创建并启用 v${result.setting.version}。` });
            notifyRuntimeModelSettingsChanged({
                version: result.setting.version,
                primary: result.setting.primary,
                reason: 'rollback'
            });
        } catch (error) {
            setMessage({ type: 'error', text: error instanceof Error ? error.message : '回滚失败' });
        } finally { setBusy(''); }
    }

    if (!data) return <section className="ops-model-settings-card">{busy ? '正在加载模型设置…' : message?.text}</section>;

    const primary = byKey.get(primaryKey);
    return (
        <div className="ops-model-settings">
            <section className="ops-model-settings-card ops-model-overview">
                <div>
                    <span className="ops-model-eyebrow">ACTIVE ROUTING · v{data.setting.version}</span>
                    <h2>{primary?.label || data.setting.primary.model}</h2>
                    <p>配置存储在 MongoDB <code>runtime_settings</code>；API Key 仅从服务端环境变量或密钥管理服务读取。</p>
                </div>
                <div className="ops-model-security">
                    <ShieldCheck size={20} />
                    <div><strong>密钥未下发浏览器</strong><span>credentialSource: server-secret</span></div>
                </div>
            </section>

            {message ? <div className={`ops-model-message ${message.type}`} role="status">{message.text}</div> : null}

            <section className="ops-model-settings-card">
                <div className="section-head">
                    <div><h2>模型路由</h2><p>备用链仅在服务端识别到明确的 <code>quota_exhausted</code> 时按顺序切换。</p></div>
                    <span className="ops-model-version">更新人 {data.setting.updatedBy?.email || 'system'} · {formatDate(data.setting.updatedAt)}</span>
                </div>

                <div className="ops-model-form-grid">
                    <label>
                        <span>当前主模型</span>
                        <select value={primaryKey} onChange={(event) => {
                            const next = event.target.value;
                            setPrimaryKey(next);
                            setFallbackKeys((items) => items.filter((item) => item !== next));
                        }}>
                            {eligible.map((item) => <option key={modelKey(item)} value={modelKey(item)} disabled={!item.credentialConfigured}>{item.label} · {item.provider}{item.credentialConfigured ? '' : '（凭据未配置）'}</option>)}
                        </select>
                    </label>
                    <label>
                        <span>变更说明（进入审计历史）</span>
                        <input value={changeNote} maxLength={300} onChange={(event) => setChangeNote(event.target.value)} placeholder="例如：免费额度耗尽，切换主模型并增加备用链" />
                    </label>
                </div>

                <div className="ops-fallback-builder">
                    <div className="ops-fallback-heading"><strong>备用模型链</strong><span>最多 5 个 · 不对鉴权失败、内容安全拒绝或普通服务异常自动切换</span></div>
                    {fallbackKeys.length ? fallbackKeys.map((key, index) => {
                        const item = byKey.get(key);
                        return <div className="ops-fallback-row" key={key}>
                            <b>{index + 1}</b><span>{item?.label || key}</span><em>{item?.provider}</em>
                            <button type="button" aria-label="上移" disabled={index === 0} onClick={() => moveFallback(index, -1)}><ArrowUp size={15} /></button>
                            <button type="button" aria-label="下移" disabled={index === fallbackKeys.length - 1} onClick={() => moveFallback(index, 1)}><ArrowDown size={15} /></button>
                            <button type="button" aria-label="移除" onClick={() => setFallbackKeys((items) => items.filter((item) => item !== key))}><Trash2 size={15} /></button>
                        </div>;
                    }) : <div className="ops-fallback-empty">未配置备用模型。主模型额度耗尽时将直接返回明确错误。</div>}
                    <div className="ops-fallback-add">
                        <select value={fallbackCandidate} onChange={(event) => setFallbackCandidate(event.target.value)}>
                            <option value="">选择备用模型</option>
                            {availableFallbacks.map((item) => <option key={modelKey(item)} value={modelKey(item)}>{item.label}</option>)}
                        </select>
                        <button type="button" disabled={!fallbackCandidate || fallbackKeys.length >= 5} onClick={() => {
                            setFallbackKeys((items) => [...items, fallbackCandidate]);
                            setFallbackCandidate('');
                        }}>加入备用链</button>
                    </div>
                </div>

                <div className="ops-model-actions">
                    <button type="button" className="secondary" disabled={Boolean(busy)} onClick={testConnection}><PlayCircle size={17} />{busy === 'test' ? '测试中…' : '测试连接'}</button>
                    <button type="button" className="primary" disabled={!dirty || Boolean(busy)} onClick={publish}><Save size={17} />{busy === 'publish' ? '发布中…' : '发布并即时生效'}</button>
                </div>
            </section>

            <section className="ops-model-settings-card">
                <div className="section-head"><div><h2>模型目录</h2><p>免费额度为控制台托管的动态状态；应用不缓存余额和到期日。</p></div></div>
                <div className="ops-model-catalog">
                    {data.catalog.map((item: RuntimeModelCatalogItem) => <article key={modelKey(item)} className={!item.deliveryEligible ? 'incompatible' : ''}>
                        <div><strong>{item.label}</strong><code>{item.model}</code></div>
                        <div className="ops-model-tags">
                            <span>{purposeLabels[item.purpose] || item.purpose}</span>
                            {item.freeTierEligible ? <span>免费额度 · 控制台管理</span> : null}
                            <span className={item.credentialConfigured ? 'ready' : 'missing'}>{item.credentialConfigured ? '凭据已配置' : '凭据未配置'}</span>
                            {!item.deliveryEligible ? <span>不可加入通用链</span> : <span><CheckCircle2 size={12} />交付链兼容</span>}
                        </div>
                    </article>)}
                </div>
            </section>

            <section className="ops-model-settings-card">
                <div className="section-head"><div><h2><History size={19} />版本历史</h2><p>回滚不会删除历史，而是基于旧版本创建新的当前版本。</p></div></div>
                <div className="ops-model-history">
                    {data.history.map((item) => <article key={item._id}>
                        <div><b>v{item.version}</b><span>{item.action === 'rollback' ? `回滚自 v${item.rollbackFromVersion}` : item.action}</span></div>
                        <strong>{item.primary.model}</strong>
                        <span>备用 {item.fallbackChain?.map((model) => model.model).join(' → ') || '无'}</span>
                        <span>{item.changedBy?.email || 'system'} · {formatDate(item.changedAt)}</span>
                        <em>{item.changeNote || '无变更说明'}</em>
                        <button type="button" disabled={item.version === data.setting.version || Boolean(busy)} onClick={() => rollback(item.version)}><RotateCcw size={15} />一键回滚</button>
                    </article>)}
                </div>
            </section>
        </div>
    );
}
