import { MongoClient } from 'mongodb';
import { config } from '../src/config.js';

function argument (name) {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? process.argv[index + 1] : '';
}

const action = argument('action');
const email = argument('email').trim().toLowerCase();
const expiresAt = argument('expires-at').trim();

if (!['enable', 'revoke'].includes(action) || !email) {
    console.error('Usage: npm run access:manage -- --action <enable|revoke> --email <exact-email> [--expires-at <ISO-8601>]');
    process.exitCode = 2;
} else if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
    console.error('--expires-at must be a valid ISO-8601 date-time');
    process.exitCode = 2;
} else {
    const client = new MongoClient(config.mongodbUri);
    try {
        await client.connect();
        const users = client.db().collection('users');
        const patch = action === 'revoke'
            ? {
                $set: { disabledAt: new Date(), updatedAt: new Date() },
                $inc: { tokenVersion: 1 }
            }
            : {
                $set: {
                    disabledAt: null,
                    demoExpiresAt: expiresAt ? new Date(expiresAt) : null,
                    updatedAt: new Date()
                },
                $inc: { tokenVersion: 1 }
            };
        const result = await users.updateOne({ email }, patch);
        if (!result.matchedCount) {
            console.error(`No existing application user found for ${email}. Let the user complete Access login once before managing it.`);
            process.exitCode = 1;
        } else {
            console.log(`${action === 'revoke' ? 'Revoked' : 'Enabled'} demo access for ${email}; all previously issued application sessions are invalid.`);
        }
    } finally {
        await client.close();
    }
}
