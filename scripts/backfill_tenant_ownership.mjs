import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
const db = client.db();

const fallbackTenantId = 'tenant-demo';
const fallbackCreatedBy = 'system';

async function backfill (collection) {
    const cursor = db.collection(collection).find({
        $or: [{ tenantId: { $exists: false } }, { createdBy: { $exists: false } }]
    });
    let count = 0;
    for await (const doc of cursor) {
        await db.collection(collection).updateOne(
            { _id: doc._id },
            {
                $set: {
                    tenantId: doc.tenantId || fallbackTenantId,
                    createdBy: doc.createdBy || fallbackCreatedBy
                }
            }
        );
        count++;
    }
    console.log(`${collection}: backfilled ${count}`);
}

await backfill('agent_sessions');
await backfill('agent_runs');
await client.close();