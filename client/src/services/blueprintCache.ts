type BlueprintWithRuntime = {
  runtime?: {
    llm?: unknown;
    rag?: unknown;
  };
};

type CacheEnvelope = {
  version: 1;
  cachedAt: string;
  blueprint: BlueprintWithRuntime;
};

const CACHE_PREFIX = 'aidemo:blueprint:v2';
const LEGACY_CACHE_KEY = 'aidemo.blueprint';
const LOADING_LLM = {
  provider: 'runtime',
  mode: 'loading',
  model: 'loading',
  configured: false
};

function cacheKey(tenantId: string) {
  const environment = import.meta.env.MODE || 'unknown';
  return `${CACHE_PREFIX}:${encodeURIComponent(environment)}:${encodeURIComponent(tenantId || 'anonymous')}`;
}

export function readBlueprintCache<T>(tenantId: string): T | null {
  // Remove the old global cache because it could cross tenants and retained dynamic LLM routing state.
  localStorage.removeItem(LEGACY_CACHE_KEY);
  const raw = localStorage.getItem(cacheKey(tenantId));
  if (!raw) return null;
  try {
    const envelope = JSON.parse(raw) as CacheEnvelope;
    if (envelope.version !== 1 || !envelope.blueprint) throw new Error('unsupported blueprint cache');
    return {
      ...envelope.blueprint,
      runtime: {
        ...(envelope.blueprint.runtime || {}),
        llm: LOADING_LLM
      }
    } as T;
  } catch {
    localStorage.removeItem(cacheKey(tenantId));
    return null;
  }
}

export function writeBlueprintCache<T extends BlueprintWithRuntime>(tenantId: string, blueprint: T) {
  const { llm: _dynamicLlm, ...stableRuntime } = blueprint.runtime || {};
  const envelope: CacheEnvelope = {
    version: 1,
    cachedAt: new Date().toISOString(),
    blueprint: {
      ...blueprint,
      runtime: stableRuntime
    }
  };
  localStorage.setItem(cacheKey(tenantId), JSON.stringify(envelope));
}
