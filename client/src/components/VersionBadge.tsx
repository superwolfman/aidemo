import { useEffect, useState } from 'react';
import { request } from '../api/client';

const clientVersion = {
    commit: typeof __APP_COMMIT__ !== 'undefined' ? __APP_COMMIT__ : 'dev',
    shortCommit: typeof __APP_SHORT_COMMIT__ !== 'undefined' ? __APP_SHORT_COMMIT__ : 'dev',
    branch: typeof __APP_BRANCH__ !== 'undefined' ? __APP_BRANCH__ : 'dev',
    describe: typeof __APP_DESCRIBE__ !== 'undefined' ? __APP_DESCRIBE__ : 'dev',
    dirty: typeof __APP_DIRTY__ !== 'undefined' ? __APP_DIRTY__ : false,
    buildTime: typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : undefined
};

type ServerVersion = {
    commit: string;
    shortCommit: string;
    branch: string;
    describe: string;
    dirty: boolean;
    buildTime: string;
    node: string;
};

export function VersionBadge() {
    const [server, setServer] = useState<ServerVersion | null>(null);
    const [error, setError] = useState<string>('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        request('/api/version')
            .then((data) => setServer(data as ServerVersion))
            .catch((err) => setError(err instanceof Error ? err.message : String(err)))
            .finally(() => setLoading(false));
    }, []);

    const validCommit = (value?: string) => Boolean(value && /^[0-9a-f]{40}$/i.test(value));
    const production = import.meta.env.PROD;
    const bakedClientCommit = typeof __APP_COMMIT__ !== 'undefined' ? __APP_COMMIT__ : '';
    const clientCommit = validCommit(bakedClientCommit) ? bakedClientCommit : '';
    const serverCommit = validCommit(server?.commit) ? server.commit : '';
    const consistent = clientCommit && serverCommit && clientCommit === serverCommit;
    const clientShort = clientCommit ? clientCommit.slice(0, 7) : '—';
    const serverShort = serverCommit ? serverCommit.slice(0, 7) : (error ? '—' : '—');
    const dirty = server?.dirty ? '*' : '';

    // 三态：
    // 1) 生产 + 版本一致 → 不展示；
    // 2) 生产 + 版本不一致 / 缺失 → 报警；
    // 3) 测试 / 本地 → 始终展示用于联调。
    if (production && !error && (loading || consistent)) return null;

    const statusClass = error
        ? 'version-error'
        : production
            ? (consistent ? 'version-ok' : 'version-mismatch')
            : 'version-dev';
    const hint = production
        ? (error ? '版本接口不可用' : !consistent ? '线上版本不一致' : '')
        : '';

    return (
        <div className={`version-badge ${statusClass}`} title={`client=${clientCommit || 'unknown'} server=${server?.commit || error}`}>
            <div className="version-row">
                <span className="version-label">FE</span>
                <span className="version-value">{clientShort}{clientCommit ? dirty : ''}</span>
            </div>
            <div className="version-row">
                <span className="version-label">BE</span>
                <span className="version-value">{serverShort}{serverCommit ? dirty : ''}</span>
            </div>
            {hint ? <div className="version-hint">{hint}</div> : null}
        </div>
    );
}
