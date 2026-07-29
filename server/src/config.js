import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });
dotenv.config();

// const ragBackend = process.env.RAG_BACKEND || 'local-hash';
const defaultMongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/growth_ai_assistant';
const mongodbAtlasUri = process.env.MONGODB_ATLAS_URI || '';
const atlasCandidateUri = mongodbAtlasUri || (defaultMongoUri.startsWith('mongodb+srv://') ? defaultMongoUri : '');
// const selectedMongoUri = ragBackend === 'mongodb-atlas' && atlasCandidateUri ? atlasCandidateUri : defaultMongoUri;

// 有 Atlas URI 即默认启用真实向量库（显式 RAG_BACKEND=local-hash 可强制关闭）
const ragBackend = process.env.RAG_BACKEND || (atlasCandidateUri ? 'mongodb-atlas' : 'local-hash');
const isAtlas = ragBackend === 'mongodb-atlas';
const selectedMongoUri = isAtlas && atlasCandidateUri ? atlasCandidateUri : defaultMongoUri;

function redactConnection (uri) {
    if (!uri) return 'not configured';
    try {
        const parsed = new URL(uri);
        const dbName = parsed.pathname?.replace(/^\//, '') || 'default-db';
        return `${parsed.protocol}//${parsed.hostname}/${dbName}`;
    } catch {
        return uri.replace(/\/\/([^:@]+):([^@]+)@/, '//***:***@');
    }
}

export const config = {
    port: Number(process.env.PORT || 4000),
    host: process.env.HOST || '127.0.0.1',
    jwtSecret: process.env.JWT_SECRET || 'local-demo-secret',
    clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    clientOrigins: (process.env.CLIENT_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    mongodbUri: selectedMongoUri,
    mongodbAtlasUri,
    mongodbAtlasConfigured: ragBackend === 'mongodb-atlas' && selectedMongoUri.startsWith('mongodb+srv://'),
    llmProvider: process.env.LLM_PROVIDER || 'mock',
    llmApiKeys: {
        openai: process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '',
        deepseek: process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || '',
        dashscope: process.env.DASHSCOPE_API_KEY || process.env.LLM_API_KEY || '',
        'openai-compatible': process.env.LLM_API_KEY || ''
    },
    llmApiKey:
        process.env.LLM_API_KEY ||
        process.env.OPENAI_API_KEY ||
        process.env.DEEPSEEK_API_KEY ||
        process.env.DASHSCOPE_API_KEY ||
        '',
    llmBaseUrl: process.env.LLM_BASE_URL || '',
    llmModel: process.env.LLM_MODEL || '',
    ragBackend,
    ragVectorIndex: process.env.RAG_VECTOR_INDEX || 'chunks_vector_index',
    ragVectorPath: process.env.RAG_VECTOR_PATH || 'embedding',
    // atlas 时自动切 1024 维 + 真实 provider + 自动建索引，消除 G1
    ragVectorDimensions: Number(process.env.RAG_VECTOR_DIMENSIONS || (isAtlas ? 1024 : 96)),
    embeddingProvider: process.env.EMBEDDING_PROVIDER || (isAtlas ? 'dashscope' : 'local'),
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-v3',
    embeddingBaseUrl: process.env.EMBEDDING_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    embeddingApiKey: process.env.EMBEDDING_API_KEY || process.env.DASHSCOPE_API_KEY || process.env.LLM_API_KEY || '',
    ragCreateVectorIndex: process.env.RAG_CREATE_VECTOR_INDEX === 'true' || isAtlas,
    redactedMongoUri: redactConnection(selectedMongoUri)
};
