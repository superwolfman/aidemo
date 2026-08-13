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

    useEffect(() => {
        request('/api/version')
            .then((data) => setServer(data as ServerVersion))
            .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }, []);

    const validCommit = (value?: string) => Boolean(value && /^[0-9a-f]{40}$/i.test(value));
    const clientKnown = validCommit(clientVersion.commit);
    const serverKnown = validCommit(server?.commit);
    const consistent = clientKnown && serverKnown && server?.commit === clientVersion.commit;
    const statusClass = error ? 'version-error' : consistent ? 'version-ok' : 'version-mismatch';
    const production = typeof __APP_ENV__ !== 'undefined' && __APP_ENV__ === 'production';

    // 生产版本一致时保持界面干净；开发环境保留版本信息用于联调。
    if (production && consistent) return null;

    const hint = !clientKnown || !serverKnown
        ? '版本信息缺失'
        : !consistent
            ? '版本不一致'
            : '';

    return (
        <div className={`version-badge ${statusClass}`} title={`client=${clientVersion.commit} server=${server?.commit || error}`}>
            <div className="version-row">
                <span className="version-label">FE</span>
                <span className="version-value">{clientKnown ? clientVersion.shortCommit : '—'}{clientVersion.dirty ? '*' : ''}</span>
            </div>
            <div className="version-row">
                <span className="version-label">BE</span>
                <span className="version-value">{error ? '—' : server?.shortCommit}{server?.dirty ? '*' : ''}</span>
            </div>
            {hint && !error ? <div className="version-hint">{hint}</div> : null}
        </div>
    );
}
