// 给已有账号追加一个演示租户（tenant-demo-2 / member），便于验证“切换租户”与租户隔离。
// 用法：MONGODB_URI="..." node server/scripts/add-demo-tenant.mjs [email]
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
    console.error('请设置环境变量 MONGODB_URI');
    process.exit(1);
}

const email = process.argv[2] || 'removed-default-admin@example.invalid';
const DEMO_TENANT = 'tenant-demo-2';

const client = new MongoClient(uri);
await client.connect();
const db = client.db();

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
