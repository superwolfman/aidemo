import dotenv from 'dotenv';

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
  llmProvider: process.env.LLM_PROVIDER || 'mock'
};
