import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const staged = process.argv.includes('--staged');
const forbiddenAdmin = ['admin', 'growth.ai'].join('@');
const forbiddenDemoPassword = ['demo', '123456'].join('');

function escaped (value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function placeholder (value) {
    const normalized = String(value).toLowerCase();
    return normalized.includes('<') ||
        normalized.includes('placeholder') ||
        normalized.includes('example') ||
        normalized.includes('replace-') ||
        normalized.includes('change-') ||
        normalized === 'secret' ||
        normalized.startsWith('sk-your-') ||
        normalized.startsWith('sk-xxx');
}

const detectors = [
    {
        name: 'private-key',
        matches: (line) => /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(line)
    },
    {
        name: 'credentialed-mongodb-uri',
        matches: (line) => {
            const match = line.match(/mongodb(?:\+srv)?:\/\/[^\s/:@]+:([^\s/@]+)@/i);
            return Boolean(match && !placeholder(match[1]));
        }
    },
    {
        name: 'provider-api-key',
        matches: (line) => {
            const match = line.match(/\bsk-[A-Za-z0-9._-]{16,}\b/);
            return Boolean(match && !placeholder(match[0]));
        }
    },
    { name: 'removed-default-admin', matches: (line) => new RegExp(escaped(forbiddenAdmin), 'i').test(line) },
    { name: 'removed-public-password', matches: (line) => new RegExp(escaped(forbiddenDemoPassword), 'i').test(line) }
];

function git (...args) {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function filesToScan () {
    const output = staged
        ? git('diff', '--cached', '--name-only', '--diff-filter=ACMR')
        : git('ls-files');
    return output.split('\n').map((item) => item.trim()).filter(Boolean);
}

function contentFor (file) {
    if (staged) {
        try {
            return git('show', `:${file}`);
        } catch {
            return '';
        }
    }
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return '';
    }
}

const findings = [];
for (const file of filesToScan()) {
    const content = contentFor(file);
    if (!content || content.includes('\0')) continue;
    const lines = content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
        for (const detector of detectors) {
            if (detector.matches(lines[index])) {
                findings.push(`${file}:${index + 1} [${detector.name}]`);
            }
        }
    }
}

if (findings.length) {
    console.error('Credential leak scan failed (secret values are intentionally hidden):');
    for (const finding of findings) console.error(`  ${finding}`);
    process.exit(1);
}

console.log(`Credential leak scan passed (${staged ? 'staged' : 'tracked'} files).`);
