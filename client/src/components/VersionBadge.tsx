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
    // FE 优先取构建期烘进去的 commit；缺失或无效时直接回退到服务端版本，避免出现 FE/BE 不一致。
    const bakedClientCommit = typeof __APP_COMMIT__ !== 'undefined' ? __APP_COMMIT__ : '';
    const clientCommit = validCommit(bakedClientCommit)
        ? bakedClientCommit
        : (server?.commit && validCommit(server.commit) ? server.commit : '');
    const clientShortCommit = clientCommit ? clientCommit.slice(0, 7) : '—';
    const clientDirty = typeof __APP_DIRTY__ !== 'undefined' && validCommit(bakedClientCommit)
        ? __APP_DIRTY__
        : Boolean(server?.dirty);
    const serverShortCommit = server && validCommit(server.commit) ? server.shortCommit : (error ? '—' : '—');
    const production = typeof __APP_ENV__ !== 'undefined' && __APP_ENV__ === 'production';

    // 生产版本有效时保持界面干净；只有缺版本/接口报错时才显示。
    if (production && clientCommit && !error) return null;

    return (
        <div className="version-badge" title={`client=${clientCommit || 'unknown'} server=${server?.commit || error}`}>
            <div className="version-row">
                <span className="version-label">FE</span>
                <span className="version-value">{clientShortCommit}{clientDirty ? '*' : ''}</span>
            </div>
            <div className="version-row">
                <span className="version-label">BE</span>
                <span className="version-value">{serverShortCommit}{server?.dirty ? '*' : ''}</span>
            </div>
        </div>
    );
}
