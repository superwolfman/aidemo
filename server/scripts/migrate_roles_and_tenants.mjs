// 一次性迁移脚本：将历史库中不一致的用户角色统一为标准角色。
// 运行：在项目 .env 中配置连接与 MONGODB_DB_NAME 后执行本脚本
import { MongoClient } from 'mongodb';
import { config } from '../src/config.js';

if (!config.mongodbUri) {
  console.error('MONGODB_URI or MONGODB_ATLAS_URI is required');
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

const client = new MongoClient(config.mongodbUri);
const db = client.db(config.mongodbDatabase);

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
