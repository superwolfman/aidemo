import express from 'express';
import cors from 'cors';
import http from 'node:http';
import http2 from 'node:http2';
import fs from 'node:fs';
import { config } from './config.js';
import { createStore } from './store/index.js';
import { requireAuth } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { copilotRouter } from './routes/copilot.js';
import { agentStudioRouter } from './routes/agentStudio.js';
import { seedKnowledgeIfEmpty } from './utils/seedKnowledge.js';
import { enforceDemoPermissions } from './middleware/demoAuthorization.js';
import { initializeRuntimeModelSettings } from './services/runtimeModelSettings.js';

const store = await createStore();
await initializeRuntimeModelSettings(store);
const seedResult = await seedKnowledgeIfEmpty(store);
if (seedResult.seeded) {
    console.log(`[server] auto seeded ${seedResult.count} knowledge documents`);
}
const app = express();
app.set('trust proxy', 1);
const auth = requireAuth(store);

app.use(
    cors({
        origin (origin, callback) {
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
    res.json({
        ok: true,
        store: store.kind,
        environment: config.mongodbEnvironment,
        database: store.kind === 'mongo' ? config.mongodbDatabase : undefined
    });
});

app.use('/api/auth', authRouter(store, auth));
app.use('/api/copilot', auth, enforceDemoPermissions(store, 'copilot'), copilotRouter(store));
app.use('/api/agent-studio', auth, enforceDemoPermissions(store, 'agentStudio'), agentStudioRouter(store));

app.use((err, req, res, next) => {
    console.error(err);
    const statusCode = Number(err.statusCode) || 500;
    res.status(statusCode).json({
        message: statusCode === 500 ? 'Internal server error' : err.message,
        ...(err.code ? { code: err.code } : {})
    });
});

// const server = http.createServer(app);

// server.listen(config.port, config.host, () => {
//     console.log(`[server] http://${config.host}:${config.port}`);
//     console.log(
//         `[server] RAG backend=${config.ragBackend}, atlasConfigured=${config.mongodbAtlasConfigured}, mongo=${config.redactedMongoUri}`
//     );
// });

// 开发环境证书（若无则用 http.createServer 降级）
let server;
if (process.env.ENABLE_HTTP2 === 'true' && fs.existsSync('./server.crt')) {
    server = http2.createSecureServer(
        {
            key: fs.readFileSync('./server.key'),
            cert: fs.readFileSync('./server.crt'),
            allowHTTP1: true   // 允许旧客户端回退 HTTP/1.1
        },
        app
    );
} else {
    server = http.createServer(app);
}

server.listen(config.port, config.host, () => {
    console.log(`[server] http${process.env.ENABLE_HTTP2 === 'true' ? '2' : ''}://${config.host}:${config.port}`);
});
