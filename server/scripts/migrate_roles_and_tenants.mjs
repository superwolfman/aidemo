// 一次性迁移脚本：将历史库中不一致的用户角色统一为标准角色。
// 运行：MONGODB_URI=xxx node server/scripts/migrate_roles_and_tenants.mjs
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI env required');
  process.exit(1);
}

const ROLE_MAP = {
  growth_admin: 'admin',
  ai_copilot_admin: 'admin',
  admin: 'admin',
  member: 'member',
  service: 'service',
  owner: 'owner'
};

const client = new MongoClient(uri);
const db = client.db();

async function migrateUsers () {
  const users = db.collection('users');
  const cursor = users.find({});
  let count = 0;
  for await (const user of cursor) {
    const normalizedRole = ROLE_MAP[user.role] || 'member';
    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          role: normalizedRole,
          tenantId: user.tenantId || 'tenant-demo',
          allowedKnowledgeScopes: Array.isArray(user.allowedKnowledgeScopes)
            ? user.allowedKnowledgeScopes
            : ['*']
        }
      }
    );
    count++;
  }
  console.log(`users migrated: ${count}`);
}

await migrateUsers();
await client.close();
