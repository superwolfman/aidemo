// 生产环境优先与页面同源（/api 走 nginx 反代），本地开发回退到 127.0.0.1:4000
const isLocalhost = typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1|::1)$/.test(window.location.hostname);
const API_BASE = import.meta.env.VITE_API_BASE || (isLocalhost ? 'http://127.0.0.1:4000' : '');
export const tokenKey = 'enablement-ai-token';

type RequestOptions = RequestInit & {
  headers?: Record<string, string>;
};

type StreamHandlers = Record<string, (data: any) => void> & {
  any?: (event: string, data: any) => void;
};

export async function request(path: string, options: RequestOptions = {}) {
  const token = localStorage.getItem(tokenKey);
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || 'Request failed');
  }

  return response.json();
}

export async function streamRequest(path: string, body: Record<string, unknown>, handlers: StreamHandlers = {}, signal?: AbortSignal) {
  const token = localStorage.getItem(tokenKey);
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok || !response.body) throw new Error('Stream failed');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() || '';

    for (const frame of frames) {
      const event = frame.split('\n').find((line) => line.startsWith('event: '))?.replace('event: ', '') || 'message';
      const raw = frame.split('\n').find((line) => line.startsWith('data: '))?.replace('data: ', '');
      if (!raw) continue;
      const data = JSON.parse(raw);
      handlers[event]?.(data);
      handlers.any?.(event, data);
    }
  }
}
