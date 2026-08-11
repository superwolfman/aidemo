export class SlidingWindowLimiter {
    constructor ({ limit, windowMs, maxKeys = 10000 }) {
        this.limit = limit;
        this.windowMs = windowMs;
        this.maxKeys = maxKeys;
        this.entries = new Map();
    }

    consume (key, nowMs = Date.now()) {
        const normalizedKey = String(key || 'anonymous');
        if (!this.entries.has(normalizedKey) && this.entries.size >= this.maxKeys) {
            const oldestKey = this.entries.keys().next().value;
            if (oldestKey !== undefined) this.entries.delete(oldestKey);
        }
        const cutoff = nowMs - this.windowMs;
        const active = (this.entries.get(normalizedKey) || []).filter((timestamp) => timestamp > cutoff);
        const allowed = active.length < this.limit;
        if (allowed) active.push(nowMs);
        this.entries.set(normalizedKey, active);
        return {
            allowed,
            remaining: Math.max(0, this.limit - active.length),
            retryAfterSeconds: active.length
                ? Math.max(1, Math.ceil((active[0] + this.windowMs - nowMs) / 1000))
                : 0
        };
    }

    reset (key) {
        this.entries.delete(String(key || 'anonymous'));
    }
}
