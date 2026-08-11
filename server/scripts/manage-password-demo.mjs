import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { config } from '../src/config.js';
import { ROLES } from '../src/security/roles.js';
import { hashPassword } from '../src/utils/password.js';

function argument (name) {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

const action = argument('action');
const email = (argument('email') || 'interviewer.demo@aidemo.invalid').toLowerCase();
const requestedExpiry = argument('expires-at');
const requestedCredentialFile = argument('credential-file');

if (!['create', 'revoke'].includes(action)) {
    console.error('Usage: node server/scripts/manage-password-demo.mjs --action <create|revoke> [--email <email>] [--expires-at <ISO-8601>] [--credential-file <private-file>]');
    process.exitCode = 2;
} else if (requestedExpiry && Number.isNaN(Date.parse(requestedExpiry))) {
    console.error('--expires-at must be a valid ISO-8601 date-time');
    process.exitCode = 2;
} else {
    const client = new MongoClient(config.mongodbUri);
    try {
        await client.connect();
        const users = client.db(config.mongodbDatabase).collection('users');
        if (action === 'revoke') {
            const result = await users.updateOne(
                { email },
                {
                    $set: { disabledAt: new Date(), updatedAt: new Date() },
                    $inc: { tokenVersion: 1 }
                }
            );
            if (!result.matchedCount) {
                throw new Error(`No demo user found for ${email}`);
            }
            console.log(`REVOKED_EMAIL=${email}`);
        } else {
            const password = crypto.randomBytes(18).toString('base64url');
            const expiresAt = requestedExpiry
                ? new Date(requestedExpiry)
                : new Date(Date.now() + 4 * 60 * 60 * 1000);
            const now = new Date();
            await users.updateOne(
                { email },
                {
                    $set: {
                        name: 'Interview Demo',
                        role: ROLES.DEMO_VIEWER,
                        tenantId: config.demoTenantId,
                        tenants: [{ tenantId: config.demoTenantId, role: ROLES.DEMO_VIEWER }],
                        activeTenantId: config.demoTenantId,
                        allowedKnowledgeScopes: config.demoAllowedKnowledgeScopes,
                        department: 'Interview Demo',
                        authProvider: 'password',
                        passwordHash: hashPassword(password),
                        disabledAt: null,
                        demoExpiresAt: expiresAt,
                        updatedAt: now
                    },
                    $setOnInsert: { createdAt: now },
                    $inc: { tokenVersion: 1 }
                },
                { upsert: true }
            );
            const credentialFile = path.resolve(
                requestedCredentialFile || '.local/credentials/demo-account.env'
            );
            await fs.mkdir(path.dirname(credentialFile), { recursive: true, mode: 0o700 });
            await fs.writeFile(
                credentialFile,
                `DEMO_EMAIL=${email}\nDEMO_PASSWORD=${password}\nDEMO_EXPIRES_AT=${expiresAt.toISOString()}\n`,
                { encoding: 'utf8', mode: 0o600 }
            );
            await fs.chmod(credentialFile, 0o600);
            console.log(JSON.stringify({
                created: true,
                email,
                expiresAt: expiresAt.toISOString(),
                credentialFile
            }));
        }
    } finally {
        await client.close();
    }
}
