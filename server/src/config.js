import { loadEnvironment } from './config/env.js';
import { validateConfig } from './config/validateConfig.js';
import { defaultMongoDatabaseName, runtimeDatabaseEnvironment } from './store/mongoDatabase.js';

const nodeEnv = loadEnvironment();

const localMongoUri = 'mongodb://127.0.0.1:27017';
const configuredMongoUri =
    process.env.MONGODB_URI || '';
const defaultMongoUri = configuredMongoUri ||
    (nodeEnv === 'development' ? localMongoUri : '');
const mongodbAtlasUri = process.env.MONGODB_ATLAS_URI || '';
const atlasCandidateUri = mongodbAtlasUri ||
    (
        defaultMongoUri.startsWith('mongodb+srv://')
            ? defaultMongoUri : ''
    );
// 有 Atlas URI 即默认启用真实向量库（显式 RAG_BACKEND=local-hash 可强制关闭）
const ragBackend =
    process.env.RAG_BACKEND ||
    (atlasCandidateUri ? 'mongodb-atlas' : 'local-hash');
const isAtlas =
    ragBackend === 'mongodb-atlas';
const selectedMongoUri =
    isAtlas && atlasCandidateUri
        ? atlasCandidateUri
        : defaultMongoUri;
const mongodbDatabaseExplicit = Boolean(String(process.env.MONGODB_DB_NAME || '').trim());
const mongodbExpectedUsernameExplicit = Boolean(String(process.env.MONGODB_EXPECTED_USERNAME || '').trim());
const mongodbDatabase = String(
    process.env.MONGODB_DB_NAME || defaultMongoDatabaseName(nodeEnv)
).trim();
const mongodbEnvironment = runtimeDatabaseEnvironment(nodeEnv);

function booleanFromEnv (name, fallback = false) {
    const value = process.env[name];
    if (value === undefined) return fallback;
    return value === 'true';
}

function listFromEnv (name, fallback = '') {
    return (process.env[name] || fallback)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
}

function normalizeAccessTeamDomain (value) {
    return String(value || '')
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '');
}

const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const clientOrigins = [...new Set([
    clientOrigin,
    ...listFromEnv(
        'CLIENT_ORIGINS',
        'http://localhost:5173,http://127.0.0.1:5173'
    )
])];

function redactConnection (uri, databaseName) {
    if (!uri) return 'not configured';
    try {
        const parsed = new URL(uri);
        return `${parsed.protocol}//${parsed.hostname}/${databaseName || 'database-not-configured'}`;
    } catch {
        return uri.replace(/\/\/([^:@]+):([^@]+)@/, '//***:***@');
    }
}

export const config = {
    nodeEnv,
    port: Number(process.env.PORT || 4000),
    host: process.env.HOST || '127.0.0.1',
    jwtSecret: process.env.JWT_SECRET || (nodeEnv === 'development' ? 'local-demo-secret' : ''),
    sessionCookieName:
        process.env.SESSION_COOKIE_NAME ||
        (nodeEnv === 'production' ? '__Host-aidemo_session' : 'aidemo_session'),
    sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS || 3600),
    sessionCookieSecure:
        booleanFromEnv('SESSION_COOKIE_SECURE', nodeEnv === 'production'),
    passwordLoginEnabled: booleanFromEnv(
        'PASSWORD_LOGIN_ENABLED',
        false
    ),
    legacyBearerEnabled: booleanFromEnv(
        'LEGACY_BEARER_ENABLED',
        false
    ),
    seedDemoAdmin: booleanFromEnv(
        'SEED_DEMO_ADMIN',
        false
    ),
    demoAdminEmail: (process.env.DEMO_ADMIN_EMAIL || '').trim().toLowerCase(),
    demoAdminPassword: process.env.DEMO_ADMIN_PASSWORD || '',
    cloudflareAccessEnabled: booleanFromEnv('CF_ACCESS_ENABLED'),
    cloudflareAccessTeamDomain: normalizeAccessTeamDomain(process.env.CF_ACCESS_TEAM_DOMAIN),
    cloudflareAccessAudience: (process.env.CF_ACCESS_AUD || '').trim(),
    cloudflareAccessAllowedEmails: listFromEnv('CF_ACCESS_ALLOWED_EMAILS')
        .map((email) => email.toLowerCase()),
    demoAutoProvision: booleanFromEnv('DEMO_AUTO_PROVISION'),
    demoTenantId: (process.env.DEMO_TENANT_ID || 'tenant-interview-demo').trim(),
    demoAllowedKnowledgeScopes: listFromEnv(
        'DEMO_ALLOWED_KNOWLEDGE_SCOPES',
        'copilot,architecture,frontend,ai-native,standards,frontend-observability,engineering-governance,performance,im,sdk,investment-research,research-workbench,company-filings,industry-research,financial-analysis,research-report-generation,citation-compliance,customer-service,customer-service-knowledge,answer-generation,knowledge-correction,conversation-operations,service-quality'
    ),
    demoAccessExpiresAt: (process.env.DEMO_ACCESS_EXPIRES_AT || '').trim(),
    demoRunLimitPerHour: Number(process.env.DEMO_RUN_LIMIT_PER_HOUR || 20),
    loginAttemptLimit: Number(process.env.LOGIN_ATTEMPT_LIMIT || 5),
    loginAttemptWindowMs: Number(process.env.LOGIN_ATTEMPT_WINDOW_MS || 900000),
    // 只负责读取配置，不在这里隐藏生产环境配置错误。
    allowFileStoreFallback:
        process.env.ALLOW_FILE_STORE_FALLBACK === 'true',
    mcpTenantId:
        process.env.MCP_TENANT_ID || (nodeEnv === 'development' ? 'tenant-demo' : ''),
    mcpAllowedKnowledgeScopes: (
        process.env.MCP_ALLOWED_KNOWLEDGE_SCOPES || '*'
    ).split(',').map((scope) => scope.trim()).filter(Boolean),
    clientOrigin,
    clientOrigins,
    mongodbUri: selectedMongoUri,
    mongodbDatabase,
    mongodbDatabaseExplicit,
    mongodbEnvironment,
    mongodbExpectedUsername: String(process.env.MONGODB_EXPECTED_USERNAME || '').trim(),
    mongodbExpectedUsernameExplicit,
    mongodbAtlasUri,
    mongodbAtlasConfigured:
        ragBackend === 'mongodb-atlas' &&
        selectedMongoUri.startsWith('mongodb+srv://'),
    llmProvider:
        process.env.LLM_PROVIDER || 'mock',
    llmApiKeys: {
        openai:
            process.env.OPENAI_API_KEY ||
            process.env.LLM_API_KEY || '',
        deepseek:
            process.env.DEEPSEEK_API_KEY ||
            process.env.LLM_API_KEY ||
            '',
        dashscope:
            process.env.DASHSCOPE_API_KEY ||
            process.env.LLM_API_KEY ||
            '',
        'openai-compatible':
            process.env.LLM_API_KEY ||
            ''
    },
    llmApiKey:
        process.env.LLM_API_KEY ||
        process.env.OPENAI_API_KEY ||
        process.env.DEEPSEEK_API_KEY ||
        process.env.DASHSCOPE_API_KEY ||
        '',
    llmBaseUrl:
        process.env.LLM_BASE_URL || '',
    llmModel:
        process.env.LLM_MODEL || '',
    llmFallbackModels: listFromEnv('LLM_FALLBACK_MODELS'),
    ragBackend,
    ragVectorIndex:
        process.env.RAG_VECTOR_INDEX ||
        'chunks_vector_index_v2',
    ragVectorPath:
        process.env.RAG_VECTOR_PATH ||
        'embedding',
    // Atlas cosine 分数低于该门槛时宁可返回知识缺口，也不把弱相关内容包装成引用。
    // 显式环境变量仅作为紧急覆盖；正常门槛来自按知识域保存的 Golden Dataset 校准结果。
    ragMinVectorScore: process.env.RAG_MIN_VECTOR_SCORE
        ? Number(process.env.RAG_MIN_VECTOR_SCORE)
        : null,
    // atlas 时自动切 1024 维 + 真实 provider + 自动建索引，消除 G1
    ragVectorDimensions: Number(
        process.env.RAG_VECTOR_DIMENSIONS ||
        (isAtlas ? 1024 : 96)),
    embeddingProvider:
        process.env.EMBEDDING_PROVIDER ||
        (isAtlas ? 'dashscope' : 'local'),
    embeddingModel:
        process.env.EMBEDDING_MODEL ||
        'text-embedding-v3',
    embeddingBaseUrl:
        process.env.EMBEDDING_BASE_URL ||
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
    embeddingApiKey:
        process.env.EMBEDDING_API_KEY ||
        process.env.DASHSCOPE_API_KEY ||
        process.env.LLM_API_KEY ||
        '',
    ragCreateVectorIndex:
        process.env.RAG_CREATE_VECTOR_INDEX === 'true',
    redactedMongoUri: redactConnection(selectedMongoUri, mongodbDatabase)
};
// 必须在所有字段构建完成后调用。
validateConfig(config);
