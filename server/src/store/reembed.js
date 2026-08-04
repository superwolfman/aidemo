import { MongoClient } from 'mongodb';
import { config } from '../config.js';
import { embedTextReal, splitIntoChunks } from '../utils/embedding.js';

const seedDocs = [
    {
        title: '会员增长活动方法论',
        tags: ['growth', 'campaign'],
        content: '会员增长活动应围绕目标人群、权益刺激、渠道触达、转化路径和复购承接设计。高价值用户适合会员日和专属券，新用户适合首单礼和限时补贴，沉睡用户适合召回券和内容种草。核心指标包括曝光、点击、领取、核销、GMV、ROI 和次日留存。'
    },
    {
        title: '投放素材生产规范',
        tags: ['creative', 'ads'],
        content: '投放素材需要明确人群痛点、利益点、行动指令和可信背书。短视频首 3 秒突出场景冲突，信息流图片控制在一个主卖点。A/B 测试至少覆盖标题、利益点、视觉风格和 CTA。素材复盘关注 CTR、CVR、CPA、ROI 和疲劳衰减。'
    },
    {
        title: '运营 Agent 工具边界',
        tags: ['agent', 'workflow'],
        content: '运营 Agent 可以自动生成方案、查询知识库、生成素材、读取归因数据、创建优惠券草稿和 Push 草稿。涉及真实预算消耗、用户触达、广告发布、券生效等动作必须进入人工确认。所有工具调用需要记录输入、输出、状态和回滚策略。'
    }
];

async function main () {
    if (!config.mongodbUri?.startsWith('mongodb+srv://')) {
        console.error('An Atlas mongodb+srv MONGODB_URI is required. Aborting.');
        process.exit(1);
    }

    // 新增：reembed 是"真实向量"脚本，没 key 不能继续
    if (!config.embeddingApiKey) {
        console.error('EMBEDDING_API_KEY / DASHSCOPE_API_KEY is not set. reembed requires a real embedding provider.');
        process.exit(1);
    }

    const expectedDim = config.ragVectorDimensions;
    const tenantId = process.env.REEMBED_TENANT_ID || config.mcpTenantId;
    if (!tenantId) {
        console.error('REEMBED_TENANT_ID is required. Aborting.');
        process.exit(1);
    }
    const actorId = 'reembed-service';
    const client = new MongoClient(config.mongodbUri);
    await client.connect();
    const db = client.db();
    const chunks = db.collection('chunks');

    console.log(`[reembed] deleting documents + chunks for tenant=${tenantId} only...`);
    await chunks.deleteMany({ tenantId });
    await db.collection('documents').deleteMany({ tenantId });

    console.log('[reembed] re-embedding seed docs with real model...');
    for (const doc of seedDocs) {
        const parts = splitIntoChunks(doc.content);
        const inserted = await db.collection('documents').insertOne({
            tenantId,
            createdBy: actorId,
            title: doc.title,
            content: doc.content,
            tags: doc.tags,
            scopes: doc.tags,
            sourceType: 'manual',
            chunkCount: parts.length,
            createdAt: new Date()
        });
        const payload = [];
        for (const chunk of parts) {
            const vector = await embedTextReal(chunk, { useReal: true });

            // 新增：写入前校验维度，防止 provider/key 异常导致静默降级
            if (!Array.isArray(vector) || vector.length !== expectedDim) {
                throw new Error(
                    `Dimension mismatch for chunk in "${doc.title}": expected ${expectedDim}, got ${vector?.length}. ` +
                    'Check RAG_VECTOR_DIMENSIONS and embedding provider.'
                );
            }
            payload.push({
                tenantId,
                createdBy: actorId,
                documentId: inserted.insertedId,
                documentTitle: doc.title,
                tags: doc.tags,
                scopes: doc.tags,
                sourceType: 'manual',
                content: chunk,
                chunkIndex: payload.length,
                embedding: vector,
                createdAt: new Date()
            });
        }
        await chunks.insertMany(payload);
        console.log(`[reembed] ${doc.title}: ${payload.length} chunks`);
    }

    console.log('[reembed] ensuring vector search index at', config.ragVectorDimensions, 'dims...');
    try {
        await chunks.createSearchIndex({
            name: config.ragVectorIndex,
            type: 'vectorSearch',
            definition: {
                fields: [
                    { type: 'vector', path: config.ragVectorPath, numDimensions: config.ragVectorDimensions, similarity: 'cosine' },
                    { type: 'filter', path: 'tenantId' },
                    { type: 'filter', path: 'scopes' }
                ]
            }
        });
    } catch (e) {
        console.warn('[reembed] index creation note:', e.message);
    }

    const count = await chunks.countDocuments();
    console.log(`[reembed] done. chunks=${count}, expectedDim=${config.ragVectorDimensions}`);
    await client.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
