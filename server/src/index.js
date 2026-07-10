import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { config } from './config.js';
import { createStore } from './store/index.js';
import { requireAuth } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { ragRouter } from './routes/rag.js';
import { aiRouter } from './routes/ai.js';
import { agentRouter } from './routes/agent.js';
import { dashboardRouter } from './routes/dashboard.js';
import { harnessRouter } from './routes/harness.js';
import { observabilityRouter } from './routes/observability.js';
import { architectRouter } from './routes/architect.js';
import { enablementRouter } from './routes/enablement.js';
import { attachRealtime } from './realtime.js';

const store = await createStore();
const app = express();
const auth = requireAuth(store);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.clientOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true
  })
);
app.use(express.json({ limit: '2mb' }));

app.get('/', (req, res) => {
  res.json({
    name: 'Growth AI Assistant API',
    ok: true,
    health: '/health',
    frontend: 'http://127.0.0.1:5173'
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, store: store.kind });
});

app.get('/ws', (req, res) => {
  res.json({
    ok: true,
    type: 'websocket-endpoint',
    message: 'WebSocket 不能直接在浏览器地址栏用 ws:// 打开，请通过前端页面或 WebSocket 客户端连接。',
    websocket: `ws://${config.host}:${config.port}/ws?token=<jwt>`,
    tester: `http://${config.host}:${config.port}/ws-health`,
    frontend: 'http://127.0.0.1:5173/im'
  });
});

app.get('/ws-health', (req, res) => {
  res.json({
    ok: true,
    protocol: 'WebSocket',
    path: '/ws',
    auth: 'JWT query token required',
    usage: [
      '1. 打开 http://127.0.0.1:5173 登录平台',
      '2. 进入「平台总览」查看 overview:update 实时数据',
      '3. 进入「在线 IM」测试 im:message 双向消息和机器人回复'
    ]
  });
});

app.use('/api/auth', authRouter(store, auth));
app.use('/api/dashboard', auth, dashboardRouter(store));
app.use('/api/rag', auth, ragRouter(store));
app.use('/api/ai', auth, aiRouter());
app.use('/api/agent', auth, agentRouter(store));
app.use('/api/harness', auth, harnessRouter());
app.use('/api/observability', auth, observabilityRouter(store));
app.use('/api/architect', auth, architectRouter());
app.use('/api/enablement', auth, enablementRouter(store));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
});

const server = http.createServer(app);
attachRealtime(server, store);

server.listen(config.port, config.host, () => {
  console.log(`[server] http://${config.host}:${config.port}`);
});
