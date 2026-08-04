import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeKnowledgeScopes } from '../../security/tenantContext.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const dbFile = path.resolve(dirname, '../../../data/demo-db.json');
const tenantId = String(process.env.FILE_MIGRATION_TENANT_ID || '').trim();
const fallbackScope = String(process.env.MIGRATION_SCOPE_FALLBACK || 'architecture').trim();
const apply = process.env.MIGRATION_APPLY === 'true';

function scopesFor (record) {
    const existing = normalizeKnowledgeScopes(record.scopes);
    if (existing.length) return existing;
    const tags = normalizeKnowledgeScopes(record.tags);
    return tags.length ? tags : [fallbackScope];
}

async function main () {
    if (!tenantId) {
        throw new Error('FILE_MIGRATION_TENANT_ID is required; refusing to guess tenant ownership');
    }

    const raw = await fs.readFile(dbFile, 'utf8');
    const db = JSON.parse(raw);
    db.users = Array.isArray(db.users) ? db.users : [];
    db.documents = Array.isArray(db.documents) ? db.documents : [];
    db.chunks = Array.isArray(db.chunks) ? db.chunks : [];

    const report = {
        mode: apply ? 'apply' : 'dry-run',
        tenantId,
        users: db.users.filter((user) => !user.tenantId).length,
        documents: db.documents.filter((document) => !document.tenantId || !normalizeKnowledgeScopes(document.scopes).length).length,
        chunks: db.chunks.filter((chunk) => !chunk.tenantId || !normalizeKnowledgeScopes(chunk.scopes).length).length
    };
    console.log('[file-tenant-migration] plan', report);
    if (!apply) {
        console.log('[file-tenant-migration] dry-run only; set MIGRATION_APPLY=true after reviewing the tenant id');
        return;
    }

    const defaultActorId = db.users[0]?._id || 'file-tenant-migration';
    for (const user of db.users) {
        user.tenantId ||= tenantId;
        user.allowedKnowledgeScopes = Array.isArray(user.allowedKnowledgeScopes)
            ? user.allowedKnowledgeScopes
            : ['*'];
    }

    const documentsById = new Map();
    for (const document of db.documents) {
        document.tenantId ||= tenantId;
        document.scopes = scopesFor(document);
        document.createdBy ||= defaultActorId;
        documentsById.set(String(document._id), document);
    }

    const orphanChunkIds = [];
    for (const chunk of db.chunks) {
        const document = documentsById.get(String(chunk.documentId));
        if (!document) {
            orphanChunkIds.push(String(chunk._id));
            continue;
        }
        chunk.tenantId = document.tenantId;
        chunk.scopes = document.scopes;
        chunk.createdBy ||= document.createdBy;
    }
    if (orphanChunkIds.length) {
        throw new Error(`Found ${orphanChunkIds.length} orphan chunks; ownership was not guessed: ${orphanChunkIds.slice(0, 10).join(', ')}`);
    }

    const backup = `${dbFile}.bak-${Date.now()}`;
    const temporary = `${dbFile}.tenant-migration.tmp`;
    await fs.copyFile(dbFile, backup);
    await fs.writeFile(temporary, JSON.stringify(db, null, 2));
    await fs.rename(temporary, dbFile);
    console.log('[file-tenant-migration] complete', { backup });
}

main().catch((error) => {
    console.error('[file-tenant-migration] failed', error);
    process.exitCode = 1;
});
