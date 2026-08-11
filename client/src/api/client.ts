// 生产环境优先与页面同源（/api 走 nginx 反代），本地开发回退到 127.0.0.1:4000
const isLocalhost = typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1|::1)$/.test(window.location.hostname);
const API_BASE = import.meta.env.VITE_API_BASE || (isLocalhost ? 'http://127.0.0.1:4000' : '');
export const tokenKey = 'enablement-ai-token';
let accessSessionEnabled = false;
let accessExchangePromise: Promise<void> | null = null;

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type RequestOptions = RequestInit & {
  headers?: Record<string, string>;
};

type StreamHandlers = Record<string, (data: any) => void> & {
  any?: (event: string, data: any) => void;
};

export function configureAccessSession(enabled: boolean) {
  accessSessionEnabled = enabled;
}

async function exchangeAccessSession() {
  if (!accessExchangePromise) {
    accessExchangePromise = fetch(`${API_BASE}/api/auth/access/session`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    }).then(async (response) => {
      if (response.ok) return;
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new ApiError(error.message || 'Access session exchange failed', response.status, error.code);
    }).finally(() => {
      accessExchangePromise = null;
    });
  }
  return accessExchangePromise;
}

async function fetchWithSession(path: string, options: RequestInit) {
  let response = await fetch(`${API_BASE}${path}`, options);
  const canExchange = accessSessionEnabled &&
    response.status === 401 &&
    !path.startsWith('/api/auth/access/session') &&
    !path.startsWith('/api/auth/bootstrap') &&
    !path.startsWith('/api/auth/login');
  if (canExchange) {
    await exchangeAccessSession();
    response = await fetch(`${API_BASE}${path}`, options);
  }
  return response;
}

export async function request(path: string, options: RequestOptions = {}) {
  const token = localStorage.getItem(tokenKey);
  const response = await fetchWithSession(path, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new ApiError(error.message || 'Request failed', response.status, error.code);
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function streamRequest(path: string, body: Record<string, unknown>, handlers: StreamHandlers = {}, signal?: AbortSignal) {
  const token = localStorage.getItem(tokenKey);
  const response = await fetchWithSession(path, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({ message: 'Stream failed' }));
    throw new ApiError(error.message || 'Stream failed', response.status, error.code);
  }

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
      if (event === 'error') {
        throw new ApiError(
          data.message || 'Stream failed',
          Number(data.statusCode || 500),
          data.code
        );
      }
    }
  }
}
