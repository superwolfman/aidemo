import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

export const config = {
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || '127.0.0.1',
  jwtSecret: process.env.JWT_SECRET || 'local-demo-secret',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  clientOrigins: (process.env.CLIENT_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/growth_ai_assistant',
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
  ragBackend: process.env.RAG_BACKEND || 'local-hash',
  ragVectorIndex: process.env.RAG_VECTOR_INDEX || 'chunks_vector_index',
  ragVectorPath: process.env.RAG_VECTOR_PATH || 'embedding',
  ragVectorDimensions: Number(process.env.RAG_VECTOR_DIMENSIONS || 96),
  ragCreateVectorIndex: process.env.RAG_CREATE_VECTOR_INDEX === 'true'
};
