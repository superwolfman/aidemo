import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';
import { config } from './config.js';

function parseToken(request) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    return url.searchParams.get('token') || '';
  } catch {
    return '';
  }
}

function send(socket, event, payload) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ event, payload, at: Date.now() }));
  }
}

async function overviewPayload(store) {
  const [documents, sessions, telemetry, skillRuns] = await Promise.all([
    store.listDocuments().catch(() => []),
    store.listRecords('assistant_sessions', 100).catch(() => []),
    store.listTelemetry(20).catch(() => []),
    store.listRecords('skill_runs', 100).catch(() => [])
  ]);

  const heartbeat = Math.floor(Date.now() / 3000);
  return {
    onlineEmployees: 86 + (heartbeat % 9),
    activeSessions: sessions.length,
    knowledgeDocs: documents.length,
    skillRuns: skillRuns.length,
    wsLatency: 24 + (heartbeat % 13),
    queueDepth: 8 + (heartbeat % 6),
    conversionSignal: Number((12.4 + (heartbeat % 5) * 0.37).toFixed(2)),
    lastTelemetry: telemetry.slice(0, 5).map((item) => ({
      traceId: item.traceId || item._id,
      type: item.type || item.event || 'telemetry',
      createdAt: item.createdAt
    }))
  };
}

function botReply(text) {
  const content = String(text || '').trim();
  if (/投诉|人工|转人工|客服/.test(content)) {
    return '已收到，我会把这条会话标记为高优先级，并建议中台同事在 5 分钟内接入人工处理。';
  }
  if (/优惠|券|活动|权益/.test(content)) {
    return '可以先确认客户等级、可用券和活动有效期。中台可通过“AI Skill 编排”生成对应话术并下发素材。';
  }
  if (/收益|保证|风险/.test(content)) {
    return '涉及收益承诺需要走合规话术：不能保证收益，应说明风险揭示并引用知识库来源。';
  }
  return `已同步给中台坐席：${content || '客户发起了咨询'}。机器人会先保持会话，等待人工补充。`;
}

export function attachRealtime(server, store) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (socket, request) => {
    const token = parseToken(request);
    let user = null;
    try {
      const decoded = jwt.verify(token, config.jwtSecret);
      user = await store.findUserById(decoded.sub);
    } catch {
      send(socket, 'auth:error', { message: 'WebSocket unauthorized' });
      socket.close(1008, 'unauthorized');
      return;
    }

    socket.user = user;
    socket.channel = 'overview';
    send(socket, 'connected', { user, channel: socket.channel });
    send(socket, 'overview:update', await overviewPayload(store));

    socket.on('message', async (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        send(socket, 'error', { message: 'Invalid JSON message' });
        return;
      }

      if (message.event === 'subscribe') {
        socket.channel = message.channel || 'overview';
        send(socket, 'subscribed', { channel: socket.channel });
      }

      if (message.event === 'im:message') {
        const payload = {
          id: `msg-${Date.now()}`,
          from: message.from || 'client',
          to: message.to || 'ops-center',
          text: message.text || '',
          createdAt: new Date().toISOString()
        };
        await store.createRecord('im_messages', payload).catch(() => null);

        for (const client of wss.clients) send(client, 'im:message', payload);

        setTimeout(() => {
          const reply = {
            id: `bot-${Date.now()}`,
            from: 'robot',
            to: payload.from,
            text: botReply(payload.text),
            createdAt: new Date().toISOString()
          };
          for (const client of wss.clients) send(client, 'im:message', reply);
        }, 420);
      }
    });
  });

  setInterval(async () => {
    if (!wss.clients.size) return;
    const payload = await overviewPayload(store);
    for (const client of wss.clients) {
      if (client.channel === 'overview' || client.channel === 'im') send(client, 'overview:update', payload);
    }
  }, 3000);

  return wss;
}
