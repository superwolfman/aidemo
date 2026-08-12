import { Activity, CheckCircle2, History, RotateCcw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../../api/client';
import {
    getLlmTimingStats,
    getRuntimeTimeoutSettings,
    publishRuntimeTimeoutSettings,
    rollbackRuntimeTimeoutSettings,
    type LlmTimingStats,
    type RuntimeTimeoutSettingsResponse,
    type TimeoutDefaults
} from '../../../services/runtimeTimeoutSettingsService';

const FIELDS: Array<{ key: keyof TimeoutDefaults; label: string; hint: string }> = [
    { key: 'requestTimeoutMs', label: '非流式总超时', hint: '一次性请求的整条上限' },
    { key: 'streamTotalTimeoutMs', label: '流式总超时', hint: '流式请求的整条上限' },
    { key: 'firstTokenTimeoutMs', label: '首字超时 (TTFT)', hint: '等待第一个 token 的时间' },
    { key: 'idleTimeoutMs', label: '空闲超时', hint: '两个 chunk 之间的最大间隔' },
    { key: 'connectProbeMs', label: '连接探测超时', hint: '连通性测试上限' }
];

const PRESETS: Record<string, TimeoutDefaults> = {
    保守: { requestTimeoutMs: 90000, streamTotalTimeoutMs: 180000, firstTokenTimeoutMs: 45000, idleTimeoutMs: 20000, connectProbeMs: 20000 },
    均衡: { requestTimeoutMs: 60000, streamTotalTimeoutMs: 120000, firstTokenTimeoutMs: 30000, idleTimeoutMs: 15000, connectProbeMs: 15000 },
    激进: { requestTimeoutMs: 30000, streamTotalTimeoutMs: 75000, firstTokenTimeoutMs: 12000, idleTimeoutMs: 8000, connectProbeMs: 8000 }
};

const FALLBACK_TRIGGERS = ['quota_exhausted', 'timeout', 'connect_error'];

function formatDate(value?: string) {
    if (!value) return '-';
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function cloneDefaults(value: TimeoutDefaults): TimeoutDefaults {
    return { ...value };
}

export function TimeoutPolicyPanel() {
    const [data, setData] = useState<RuntimeTimeoutSettingsResponse | null>(null);
    const [defaults, setDefaults] = useState<TimeoutDefaults | null>(null);
    const [perModel, setPerModel] = useState<Record<string, Partial<TimeoutDefaults>>>({});
    const [newModel, setNewModel] = useState('');
    const [triggers, setTriggers] = useState<string[]>([]);
    const [maxAttempts, setMaxAttempts] = useState(4);
    const [maxRetries, setMaxRetries] = useState(1);
    const [changeNote, setChangeNote] = useState('');
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [stats, setStats] = useState<LlmTimingStats | null>(null);

    const hydrate = useCallback((result: RuntimeTimeoutSettingsResponse) => {
        setData(result);
        setDefaults(cloneDefaults(result.setting.defaults));
        setPerModel(JSON.parse(JSON.stringify(result.setting.perModel || {})));
        setTriggers([...(result.setting.fallbackPolicy?.triggers || [])]);
        setMaxAttempts(result.setting.fallbackPolicy?.maxAttempts ?? 4);
        setMaxRetries(result.setting.retryPolicy?.maxRetries ?? 1);
    }, []);

    const load = useCallback(async () => {
        setBusy('load');
        try {
            hydrate(await getRuntimeTimeoutSettings());
            try { const timing = await getLlmTimingStats(); setStats(timing.stats); } catch { setStats(null); }
        }
        catch (error) { setMessage({ type: 'error', text: error instanceof Error ? error.message : '加载超时策略失败' }); }
        finally { setBusy(''); }
    }, [hydrate]);

    useEffect(() => { void load(); }, [load]);

    const dirty = Boolean(data && defaults) && (
        JSON.stringify(defaults) !== JSON.stringify(data!.setting.defaults) ||
        JSON.stringify(perModel) !== JSON.stringify(data!.setting.perModel || {}) ||
        JSON.stringify(triggers) !== JSON.stringify(data!.setting.fallbackPolicy?.triggers || []) ||
        Number(maxAttempts) !== Number(data!.setting.fallbackPolicy?.maxAttempts) ||
        Number(maxRetries) !== Number(data!.setting.retryPolicy?.maxRetries)
    );

    async function publish() {
        if (!data || !defaults) return;
        setBusy('publish');
        setMessage(null);
        try {
            const result = await publishRuntimeTimeoutSettings({
                defaults,
                perModel,
                fallbackPolicy: { triggers, maxAttempts: Number(maxAttempts) },
                retryPolicy: { ...data.setting.retryPolicy, maxRetries: Number(maxRetries) },
                expectedVersion: data.setting.version,
                changeNote
            });
            hydrate(result);
            setChangeNote('');
            setMessage({ type: 'success', text: `v${result.setting.version} 已发布，所有新请求即时生效，无需重启服务。` });
        } catch (error) {
            const text = error instanceof ApiError && error.status === 409
                ? '配置已被其他管理员更新，请刷新后重新确认。'
                : (error instanceof Error ? error.message : '发布失败');
            setMessage({ type: 'error', text });
        } finally { setBusy(''); }
    }

    async function rollback(targetVersion: number) {
        if (!data || !window.confirm(`确认把超时策略恢复为 v${targetVersion} 的配置？系统会创建一个新的审计版本。`)) return;
        setBusy(`rollback-${targetVersion}`);
        setMessage(null);
        try {
            const result = await rollbackRuntimeTimeoutSettings({
                targetVersion,
                expectedVersion: data.setting.version,
                changeNote: `管理员一键回滚到 v${targetVersion}`
            });
            hydrate(result);
            setMessage({ type: 'success', text: `已基于 v${targetVersion} 创建并启用 v${result.setting.version}。` });
        } catch (error) {
            setMessage({ type: 'error', text: error instanceof Error ? error.message : '回滚失败' });
        } finally { setBusy(''); }
    }

    function applyPreset(name: string) {
        const preset = PRESETS[name];
        if (preset) setDefaults(cloneDefaults(preset));
    }

    function updateDefault(field: keyof TimeoutDefaults, value: string) {
        const num = Number(value);
        setDefaults((current) => current ? { ...current, [field]: Number.isFinite(num) ? num : 0 } : current);
    }

    function updateOverride(model: string, field: keyof TimeoutDefaults, value: string) {
        const num = Number(value);
        setPerModel((current) => ({
            ...current,
            [model]: { ...current[model], [field]: Number.isFinite(num) ? num : undefined }
        }));
    }

    function addOverride() {
        const key = newModel.trim();
        if (!key || perModel[key]) return;
        setPerModel((current) => ({ ...current, [key]: {} }));
        setNewModel('');
    }

    function removeOverride(model: string) {
        setPerModel((current) => {
            const next = { ...current };
            delete next[model];
            return next;
        });
    }

    if (!data || !defaults) return <section className="ops-model-settings-card">{busy ? '正在加载超时策略…' : message?.text}</section>;

    return (
        <div className="ops-model-settings">
            <section className="ops-model-settings-card ops-model-overview">
                <div>
                    <span className="ops-model-eyebrow">ACTIVE TIMEOUT POLICY · v{data.setting.version}</span>
                    <h2>LLM 超时策略</h2>
                    <p>配置存储在 MongoDB <code>runtime_settings</code>（key=<code>llm-timeout-policy</code>）；发布后即时生效，无需重启容器。</p>
                </div>
                <div className="ops-model-security">
                    <ShieldCheck size={20} />
                    <div><strong>分级超时 + 分模型覆盖</strong><span>industry: connect / first-byte / idle / total</span></div>
                </div>
            </section>

            {message ? <div className={`ops-model-message ${message.type}`} role="status">{message.text}</div> : null}

            <section className="ops-model-settings-card">
                <div className="section-head">
                    <div><h2>默认超时</h2><p>所有未单独覆盖的模型共用此默认值。</p></div>
                    <span className="ops-model-version">更新人 {data.setting.updatedBy?.email || 'system'} · {formatDate(data.setting.updatedAt)}</span>
                </div>

                <div className="ops-model-form-grid">
                    {FIELDS.map((field) => (
                        <label key={field.key}>
                            <span>{field.label}（ms）</span>
                            <input type="number" value={defaults[field.key]} onChange={(event) => updateDefault(field.key, event.target.value)} />
                            <em>{field.hint}</em>
                        </label>
                    ))}
                </div>

                <div className="ops-fallback-add">
                    <span>预设：</span>
                    {Object.keys(PRESETS).map((name) => <button key={name} type="button" className="secondary" onClick={() => applyPreset(name)}>{name}</button>)}
                </div>
            </section>

            <section className="ops-model-settings-card">
                <div className="section-head"><div><h2>分模型覆盖</h2><p>推理型模型建议给更长的总超时与首字超时。</p></div></div>
                <div className="ops-model-history">
                    {Object.keys(perModel).map((model) => (
                        <article key={model}>
                            <div><b>{model}</b><button type="button" aria-label="移除" onClick={() => removeOverride(model)}><Trash2 size={15} /></button></div>
                            <div className="ops-model-form-grid">
                                {FIELDS.map((field) => (
                                    <label key={field.key}>
                                        <span>{field.label}（ms，留空=默认）</span>
                                        <input type="number" value={perModel[model]?.[field.key] ?? ''} onChange={(event) => updateOverride(model, field.key, event.target.value)} />
                                    </label>
                                ))}
                            </div>
                        </article>
                    ))}
                    {Object.keys(perModel).length === 0 ? <div className="ops-fallback-empty">未配置分模型覆盖。</div> : null}
                </div>
                <div className="ops-fallback-add">
                    <input value={newModel} onChange={(event) => setNewModel(event.target.value)} placeholder="模型 id，例如 deepseek-reasoner" />
                    <button type="button" disabled={!newModel.trim() || Boolean(perModel[newModel.trim()])} onClick={addOverride}>添加覆盖</button>
                </div>
            </section>

            <section className="ops-model-settings-card">
                <div className="section-head"><div><h2>降级与重试策略</h2></div></div>
                <div className="ops-model-form-grid">
                    <label>
                        <span>Fallback 触发条件</span>
                        <div className="ops-model-tags">
                            {FALLBACK_TRIGGERS.map((trigger) => (
                                <button key={trigger} type="button" className={triggers.includes(trigger) ? 'ready' : ''} onClick={() => setTriggers((current) => current.includes(trigger) ? current.filter((item) => item !== trigger) : [...current, trigger])}>
                                    {triggers.includes(trigger) ? <CheckCircle2 size={12} /> : null}{trigger}
                                </button>
                            ))}
                        </div>
                    </label>
                    <label>
                        <span>最大尝试次数</span>
                        <input type="number" min={1} max={6} value={maxAttempts} onChange={(event) => setMaxAttempts(Number(event.target.value))} />
                    </label>
                    <label>
                        <span>可重试错误最大重试次数</span>
                        <input type="number" min={0} max={3} value={maxRetries} onChange={(event) => setMaxRetries(Number(event.target.value))} />
                    </label>
                </div>
            </section>

            <section className="ops-model-settings-card">
                <div className="section-head"><div><h2><Activity size={19} />实时耗时与自适应建议</h2><p>基于近 100 次成功样本的 P95（只读，不自动改配置）。</p></div></div>
                {stats && Object.keys(stats).length > 0 ? (
                    <div className="ops-model-history">
                        {Object.entries(stats).map(([model, s]) => (
                            <article key={model}>
                                <div><b>{model}</b><span>样本 {s.count} · 超时率 {(s.timeoutRate * 100).toFixed(1)}%</span></div>
                                <span>TTFT P50 {s.ttftP50 ?? '-'}ms / P95 {s.ttftP95 ?? '-'}ms</span>
                                <span>总耗时 P50 {s.totalP50 ?? '-'}ms / P95 {s.totalP95 ?? '-'}ms</span>
                                <span>超时 {s.timeoutCount} 次</span>
                                <em>建议首字 ≈ {s.ttftP95 ? Math.round(s.ttftP95 * 1.5) : '-'}ms · 建议总超时 ≈ {s.totalP95 ? Math.round(s.totalP95 * 1.5) : '-'}ms</em>
                            </article>
                        ))}
                    </div>
                ) : <div className="ops-fallback-empty">暂无耗时样本（发起一次 LLM 调用后此处会出现统计数据）。</div>}
            </section>

            <section className="ops-model-settings-card">
                <div className="section-head"><div><h2>变更说明</h2></div></div>
                <div className="ops-model-form-grid">
                    <label>
                        <span>变更说明（进入审计历史）</span>
                        <input value={changeNote} maxLength={300} onChange={(event) => setChangeNote(event.target.value)} placeholder="例如：reasoner 总超时调到 240s" />
                    </label>
                </div>
                <div className="ops-model-actions">
                    <button type="button" className="primary" disabled={!dirty || Boolean(busy)} onClick={publish}><Save size={17} />{busy === 'publish' ? '发布中…' : '发布并即时生效'}</button>
                </div>
            </section>

            <section className="ops-model-settings-card">
                <div className="section-head"><div><h2><History size={19} />版本历史</h2><p>回滚不会删除历史，而是基于旧版本创建新的当前版本。</p></div></div>
                <div className="ops-model-history">
                    {data.history.map((item) => (
                        <article key={item._id}>
                            <div><b>v{item.version}</b><span>{item.action === 'rollback' ? `回滚自 v${item.rollbackFromVersion}` : item.action}</span></div>
                            <span>流式总超时 {item.defaults?.streamTotalTimeoutMs}ms</span>
                            <span>覆盖模型 {Object.keys(item.perModel || {}).join(', ') || '无'}</span>
                            <span>{item.changedBy?.email || 'system'} · {formatDate(item.changedAt)}</span>
                            <em>{item.changeNote || '无变更说明'}</em>
                            <button type="button" disabled={item.version === data.setting.version || Boolean(busy)} onClick={() => rollback(item.version)}><RotateCcw size={15} />一键回滚</button>
                        </article>
                    ))}
                </div>
            </section>
        </div>
    );
}
