import { config } from '../src/config.js';
import { createStore } from '../src/store/index.js';
import { seedKnowledgeIfEmpty } from '../src/utils/seedKnowledge.js';

const tenantArg = process.argv.find((argument) => argument.startsWith('--tenant='));
const tenantId = tenantArg?.slice('--tenant='.length).trim();
const apply = process.argv.includes('--apply');

if (!tenantId || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,127}$/.test(tenantId)) {
    throw new Error('必须显式传入合法租户，例如：--tenant=tenant-demo');
}

const target = {
    environment: config.mongodbEnvironment,
    database: config.mongodbDatabase,
    tenantId
};

if (!apply) {
    console.log(JSON.stringify({
        status: 'dry_run',
        message: '未写入数据库；确认目标后增加 --apply 执行幂等增量 seed。',
        target
    }, null, 2));
    process.exit(0);
}

const store = await createStore();
try {
    const result = await seedKnowledgeIfEmpty(store, {
        tenantId,
        actorId: `tenant-seed-cli:${tenantId}`
    });
    console.log(JSON.stringify({
        status: result.seeded ? 'seeded' : 'unchanged',
        target,
        result
    }, null, 2));
} finally {
    await store.client?.close?.();
}
