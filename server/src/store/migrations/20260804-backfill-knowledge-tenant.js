import { MongoClient } from 'mongodb';
import { config } from '../../config.js';
import { normalizeKnowledgeScopes } from '../../security/tenantContext.js';

const tenantId = String(process.env.MIGRATION_TENANT_ID || '').trim();
const actorId = String(process.env.MIGRATION_ACTOR_ID || 'tenant-backfill-migration').trim();
const fallbackScope = String(process.env.MIGRATION_SCOPE_FALLBACK || 'architecture').trim();
const apply = process.env.MIGRATION_APPLY === 'true';

function scopesFor (record) {
    const existing = normalizeKnowledgeScopes(record.scopes);
    if (existing.length) return existing;
    const fromTags = normalizeKnowledgeScopes(record.tags);
    return fromTags.length ? fromTags : [fallbackScope];
}

async function main () {
    if (!tenantId) {
        throw new Error('MIGRATION_TENANT_ID is required; refusing to guess tenant ownership');
    }
    if (!config.mongodbUri) {
        throw new Error('MONGODB_URI is required');
    }

    const client = new MongoClient(config.mongodbUri);
    await client.connect();

    try {
        const db = client.db();
        const users = db.collection('users');
        const documents = db.collection('documents');
        const chunks = db.collection('chunks');

        const missingUserFilter = {
            $or: [
                { tenantId: { $exists: false } },
                { tenantId: null },
                { tenantId: '' }
            ]
        };
        const missingDocumentFilter = {
            $or: [
                { tenantId: { $exists: false } },
                { tenantId: null },
                { tenantId: '' },
                { scopes: { $exists: false } },
                { scopes: { $size: 0 } }
            ]
        };

        const report = {
            mode: apply ? 'apply' : 'dry-run',
            tenantId,
            users: await users.countDocuments(missingUserFilter),
            documents: await documents.countDocuments(missingDocumentFilter),
            chunks: await chunks.countDocuments({
                $or: [
                    { tenantId: { $exists: false } },
                    { tenantId: null },
                    { tenantId: '' },
                    { scopes: { $exists: false } },
                    { scopes: { $size: 0 } }
                ]
            })
        };
        console.log('[tenant-migration] plan', report);

        if (!apply) {
            console.log('[tenant-migration] dry-run only; set MIGRATION_APPLY=true after reviewing the tenant id');
            return;
        }

        await users.updateMany(missingUserFilter, {
            $set: {
                tenantId,
                allowedKnowledgeScopes: ['*'],
                updatedAt: new Date()
            }
        });

        const cursor = documents.find(missingDocumentFilter);
        for await (const document of cursor) {
            const scopes = scopesFor(document);
            await documents.updateOne(
                { _id: document._id },
                {
                    $set: {
                        tenantId,
                        scopes,
                        createdBy: document.createdBy || actorId,
                        updatedAt: new Date()
                    }
                }
            );
            await chunks.updateMany(
                { documentId: document._id },
                {
                    $set: {
                        tenantId,
                        scopes,
                        createdBy: document.createdBy || actorId,
                        updatedAt: new Date()
                    }
                }
            );
        }

        const remainingChunks = chunks.find({
            $or: [
                { tenantId: { $exists: false } },
                { tenantId: null },
                { tenantId: '' },
                { scopes: { $exists: false } },
                { scopes: { $size: 0 } }
            ]
        });
        const orphanChunkIds = [];
        for await (const chunk of remainingChunks) {
            const document = await documents.findOne({ _id: chunk.documentId });
            if (!document) {
                orphanChunkIds.push(String(chunk._id));
                continue;
            }
            await chunks.updateOne(
                { _id: chunk._id },
                {
                    $set: {
                        tenantId: document.tenantId,
                        scopes: scopesFor(document),
                        createdBy: document.createdBy || actorId,
                        updatedAt: new Date()
                    }
                }
            );
        }

        if (orphanChunkIds.length) {
            throw new Error(`Found ${orphanChunkIds.length} orphan chunks; ownership was not guessed: ${orphanChunkIds.slice(0, 10).join(', ')}`);
        }

        await documents.createIndex({ tenantId: 1, createdAt: -1 });
        await documents.createIndex({ tenantId: 1, sourceType: 1, title: 1 });
        await chunks.createIndex({ tenantId: 1, documentId: 1 });
        await chunks.createIndex({ tenantId: 1, scopes: 1 });

        const remaining = {
            users: await users.countDocuments(missingUserFilter),
            documents: await documents.countDocuments(missingDocumentFilter),
            chunks: await chunks.countDocuments({
                $or: [
                    { tenantId: { $exists: false } },
                    { scopes: { $exists: false } },
                    { scopes: { $size: 0 } }
                ]
            })
        };
        if (remaining.users || remaining.documents || remaining.chunks) {
            throw new Error(`Tenant migration incomplete: ${JSON.stringify(remaining)}`);
        }
        console.log('[tenant-migration] complete', remaining);
    } finally {
        await client.close();
    }
}

main().catch((error) => {
    console.error('[tenant-migration] failed', error);
    process.exitCode = 1;
});
