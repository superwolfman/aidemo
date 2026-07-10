import express from 'express';

export function observabilityRouter(store) {
  const router = express.Router();

  router.get('/events', async (req, res) => {
    res.json({ events: await store.listTelemetry(80) });
  });

  router.post('/events', async (req, res) => {
    const payload = req.body || {};
    const event = await store.createTelemetry({
      type: payload.type || 'custom',
      page: payload.page || 'unknown',
      action: payload.action || 'unknown',
      release: payload.release || 'local-dev',
      traceId: payload.traceId || `trace-${Date.now()}`,
      sessionId: payload.sessionId || 'anonymous',
      duration: Number(payload.duration || 0),
      level: payload.level || 'info',
      userId: req.user._id,
      userAgent: req.headers['user-agent'],
      detail: payload.detail || {}
    });
    res.status(201).json({ event });
  });

  return router;
}
