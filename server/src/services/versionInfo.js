import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');

let cachedVersion = null;

function runGit (args, cwd = repoRoot) {
    try {
        return execSync(`git ${args.join(' ')}`, {
            cwd,
            encoding: 'utf8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'ignore']
        }).trim();
    } catch {
        return null;
    }
}

function readHeadFromGitFolder () {
    try {
        const head = readFileSync(join(repoRoot, '.git', 'HEAD'), 'utf8').trim();
        if (head.startsWith('ref:')) {
            const refPath = head.replace('ref:', '').trim();
            return readFileSync(join(repoRoot, '.git', refPath), 'utf8').trim();
        }
        return head;
    } catch {
        return null;
    }
}

function readReleaseCommit () {
    try {
        const release = JSON.parse(readFileSync(join(repoRoot, 'release-info.json'), 'utf8'));
        return /^[0-9a-f]{40}$/i.test(release.commit) ? release.commit : null;
    } catch {
        return null;
    }
}

export function getVersionInfo () {
    if (cachedVersion) return cachedVersion;

    const envCommit = /^[0-9a-f]{40}$/i.test(process.env.APP_COMMIT || '') ? process.env.APP_COMMIT : null;
    const commit = envCommit || runGit(['rev-parse', 'HEAD']) || readHeadFromGitFolder() || readReleaseCommit() || 'unknown';
    const shortCommit = commit === 'unknown' ? 'unknown' : commit.slice(0, 7);
    const branch = process.env.APP_BRANCH || runGit(['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown';
    const dirty = process.env.APP_DIRTY !== undefined
        ? process.env.APP_DIRTY === 'true'
        : (runGit(['status', '--porcelain']) || '').length > 0;
    const describe = process.env.APP_VERSION || runGit(['describe', '--always', '--tags', '--dirty']) || shortCommit;

    cachedVersion = {
        commit,
        shortCommit,
        branch,
        dirty,
        describe,
        buildTime: process.env.APP_BUILD_TIME || new Date().toISOString(),
        node: process.version
    };
    return cachedVersion;
}

export function invalidateVersionCache () {
    cachedVersion = null;
}
