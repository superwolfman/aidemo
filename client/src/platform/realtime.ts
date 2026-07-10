import { tokenKey } from '../api/client';

const WS_BASE = import.meta.env.VITE_WS_BASE || 'ws://127.0.0.1:4000/ws';

type Listener = (payload: any) => void;

export function createRealtimeClient() {
  let socket: WebSocket | null = null;
  const listeners = new Map<string, Set<Listener>>();

  function emit(event: string, payload: any) {
    listeners.get(event)?.forEach((listener) => listener(payload));
  }

  function connect() {
    if (socket && socket.readyState <= WebSocket.OPEN) return socket;
    const token = localStorage.getItem(tokenKey) || '';
    socket = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token)}`);
    socket.onmessage = (message) => {
      try {
        const frame = JSON.parse(message.data);
        emit(frame.event, frame.payload);
      } catch {
        emit('error', { message: 'Invalid realtime frame' });
      }
    };
    socket.onclose = () => {
      setTimeout(() => {
        socket = null;
        if (localStorage.getItem(tokenKey)) connect();
      }, 1200);
    };
    return socket;
  }

  return {
    connect,
    subscribe(channel: string) {
      const ws = connect();
      ws.addEventListener('open', () => ws.send(JSON.stringify({ event: 'subscribe', channel })), { once: true });
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event: 'subscribe', channel }));
    },
    send(event: string, payload: Record<string, unknown>) {
      const ws = connect();
      const sendNow = () => ws.send(JSON.stringify({ event, ...payload }));
      if (ws.readyState === WebSocket.OPEN) sendNow();
      else ws.addEventListener('open', sendNow, { once: true });
    },
    on(event: string, listener: Listener) {
      const bucket = listeners.get(event) || new Set<Listener>();
      bucket.add(listener);
      listeners.set(event, bucket);
      return () => {
        bucket.delete(listener);
      };
    }
  };
}

export const realtime = createRealtimeClient();
