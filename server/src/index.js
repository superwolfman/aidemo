import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { config } from './config.js';
import { createStore } from './store/index.js';
import { requireAuth } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { copilotRouter } from './routes/copilot.js';

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
    name: 'AI Architecture Copilot API',
    ok: true,
    health: '/health',
    frontend: 'http://127.0.0.1:5173',
    runtime: '/api/copilot/runtime',
    mcp: 'node server/src/mcp/architectureMcpServer.js'
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, store: store.kind });
});

app.use('/api/auth', authRouter(store, auth));
app.use('/api/copilot', auth, copilotRouter(store));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Internal server error' });
});

const server = http.createServer(app);

server.listen(config.port, config.host, () => {
  console.log(`[server] http://${config.host}:${config.port}`);
});
