export function initSse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
}

export function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function closeSse(res) {
  sendEvent(res, 'done', { ok: true });
  res.end();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
