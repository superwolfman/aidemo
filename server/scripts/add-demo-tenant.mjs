// 给已有账号追加一个演示租户（tenant-demo-2 / member），便于验证“切换租户”与租户隔离。
// 用法：在项目 .env 中配置连接与 MONGODB_DB_NAME 后执行 node server/scripts/add-demo-tenant.mjs [email]
import { MongoClient } from 'mongodb';
import { config } from '../src/config.js';

if (!config.mongodbUri) {
    console.error('请配置 MONGODB_URI 或 MONGODB_ATLAS_URI');
    process.exit(1);
}

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) {
    console.error('请显式传入目标用户邮箱，脚本不再使用公共默认管理员账号');
    process.exit(1);
}
const DEMO_TENANT = 'tenant-demo-2';

const client = new MongoClient(config.mongodbUri);
await client.connect();
const db = client.db(config.mongodbDatabase);

const user = await db.collection('users').findOne({ email });
if (!user) {
    console.error(`未找到用户: ${email}`);
    await client.close();
    process.exit(1);
}

const baseTenant = user.tenantId || 'tenant-demo';
const tenants = Array.isArray(user.tenants) && user.tenants.length
    ? user.tenants
    : [{ tenantId: baseTenant, role: user.role || 'admin' }];

if (!tenants.some((t) => t.tenantId === DEMO_TENANT)) {
    tenants.push({ tenantId: DEMO_TENANT, role: 'member' });
}

const activeTenantId = user.activeTenantId || baseTenant;

await db.collection('users').updateOne(
    { _id: user._id },
    { $set: { tenants, activeTenantId } }
);

console.log(`已更新 ${email}`);
console.log('tenants =', JSON.stringify(tenants, null, 2));
console.log('activeTenantId =', activeTenantId);
await client.close();
