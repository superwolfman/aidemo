const TRANSIENT_MONGO_ERROR_NAMES = new Set([
    'MongoNetworkError',
    'MongoNetworkTimeoutError',
    'MongoServerSelectionError'
]);

const TRANSIENT_MONGO_ERROR_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH'
]);

export function isTransientMongoConnectionError (error) {
    if (!error) return false;
    if (TRANSIENT_MONGO_ERROR_NAMES.has(error.name)) return true;
    if (TRANSIENT_MONGO_ERROR_CODES.has(error.code)) return true;

    const message = String(error.message || '').toLowerCase();
    return (
        message.includes('server selection timed out') ||
        message.includes('connection timed out') ||
        /connection \d+ to .+ timed out/.test(message)
    );
}

export async function retryTransientMongoOperation (
    operation,
    { retries = 1, delayMs = 150, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}
) {
    let attempt = 0;
    while (true) {
        try {
            return await operation();
        } catch (error) {
            if (attempt >= retries || !isTransientMongoConnectionError(error)) throw error;
            attempt += 1;
            await sleep(delayMs);
        }
    }
}

export function createRunPersistenceError (error) {
    const wrapped = new Error(`运行状态持久化失败：${error?.message || 'MongoDB operation failed'}`, {
        cause: error
    });
    wrapped.name = 'RunPersistenceError';
    wrapped.code = 'RUN_PERSISTENCE_FAILED';
    wrapped.statusCode = 503;
    wrapped.stage = 'persistence';
    return wrapped;
}
