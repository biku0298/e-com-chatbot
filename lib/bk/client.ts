import { readFileSync, writeFileSync } from 'node:fs';

/**
 * The ONLY way code talks to the bachpankart API.
 *
 * Development budget (BK_RATE_LIMIT on, the default outside production): one request at a time,
 * at least 1s apart, warn past 100 per rolling hour, refuse at 300. The window is persisted to
 * `.bk-api-log.json` so it survives restarts and is shared by the dev server and scripts.
 * Production chat traffic is not budgeted (BK_RATE_LIMIT off); cache, timeout and retries always apply.
 */
export const BK_CONFIG = {
  baseUrl: 'https://api.bachpankart.com/api/consumer/',
  userAgent: 'BachpanKart-Ray (Innowinds)',
  softLimitPerHour: 100,
  hardLimitPerHour: 300,
  windowMs: 60 * 60_000,
  minIntervalMs: 1_000,
  timeoutMs: 8_000,
  maxRetries: 2,
  retryBackoffMs: [1_000, 2_000],
  tooManyRequestsWaitMs: 30_000,
  cacheTtlMs: 10 * 60_000,
  logFile: '.bk-api-log.json',
};
export type BkConfig = typeof BK_CONFIG;

export type BkFailureReason = 'timeout' | 'network' | 'http_4xx' | 'http_5xx' | 'bad_json' | 'rate_limited';
export type BkSuccess<T> = { ok: true; data: T; status: number; cached: boolean; url: string };
export type BkFailure = { ok: false; reason: BkFailureReason; status?: number; url: string };
export type BkResult<T> = BkSuccess<T> | BkFailure;

/** Type guard (the repo compiles without `strict`, so `if (result.ok)` alone does not narrow). */
export function isBkFailure<T>(result: BkResult<T>): result is BkFailure {
  return !result.ok;
}

export type BkParams = URLSearchParams | Record<string, string | number | null | undefined>;

/** Persistence for the rolling request window (timestamps in ms). */
export interface RequestLogStore {
  load(): number[];
  save(timestamps: number[]): void;
}

export function fileLogStore(path: string): RequestLogStore {
  return {
    load() {
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === 'number') : [];
      } catch {
        return [];
      }
    },
    save(timestamps) {
      writeFileSync(path, JSON.stringify(timestamps));
    },
  };
}

export interface BkClientOptions {
  /** Apply the development budget. Defaults to BK_RATE_LIMIT, else on unless NODE_ENV is production. */
  rateLimit?: boolean;
  config?: Partial<BkConfig>;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  store?: RequestLogStore;
  log?: (message: string) => void;
}

function defaultRateLimit(): boolean {
  const flag = process.env.BK_RATE_LIMIT?.toLowerCase();
  if (flag === 'on' || flag === 'true') return true;
  if (flag === 'off' || flag === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

/** One HTTP attempt; `reason` is set only on failure. */
type Attempt = { status?: number; data?: unknown; reason?: Exclude<BkFailureReason, 'rate_limited'> };

export function createBkClient(options: BkClientOptions = {}) {
  const config: BkConfig = { ...BK_CONFIG, ...options.config };
  const rateLimit = options.rateLimit ?? defaultRateLimit();
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const store = options.store ?? fileLogStore(config.logFile);
  const log = options.log ?? ((message: string) => console.info(message));

  const cache = new Map<string, { expires: number; data: unknown; status: number }>();
  const inFlight = new Map<string, Promise<BkResult<unknown>>>();
  let queue: Promise<unknown> = Promise.resolve();

  function buildUrl(path: string, params?: BkParams): string {
    const url = new URL(path.replace(/^\//, ''), config.baseUrl);
    const entries = params instanceof URLSearchParams ? [...params.entries()] : Object.entries(params ?? {});
    for (const [key, value] of entries) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  function recentRequests(): number[] {
    const since = now() - config.windowMs;
    return store.load().filter(time => time > since);
  }

  function usageLine(count: number): string {
    return `used ${count} this hour (soft ${config.softLimitPerHour} / hard ${config.hardLimitPerHour})`;
  }

  /** Budget gate for one real request: refuse at the hard cap, keep 1s spacing, record the request. */
  async function reserve(): Promise<number | null> {
    if (!rateLimit) return null;
    let recent = recentRequests();
    if (recent.length >= config.hardLimitPerHour) return -1;
    const wait = recent.length ? Math.max(...recent) + config.minIntervalMs - now() : 0;
    if (wait > 0) {
      await sleep(wait);
      recent = recentRequests();
    }
    recent.push(now());
    store.save(recent);
    if (recent.length > config.softLimitPerHour) {
      log(`[bk] WARNING: past the soft limit, ${usageLine(recent.length)}`);
    }
    return recent.length;
  }

  async function attempt(url: string): Promise<Attempt> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await request(url, {
        headers: { 'User-Agent': config.userAgent, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        return { reason: response.status >= 500 ? 'http_5xx' : 'http_4xx', status: response.status };
      }
      try {
        return { status: response.status, data: await response.json() };
      } catch {
        return { reason: controller.signal.aborted ? 'timeout' : 'bad_json', status: response.status };
      }
    } catch {
      return { reason: controller.signal.aborted ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchWithRetries(url: string): Promise<BkResult<unknown>> {
    let retries = 0;
    let waitedForTooManyRequests = false;
    for (;;) {
      const used = await reserve();
      if (used === -1) {
        log(`[bk] REFUSED (hard cap reached) ${url}, ${usageLine(recentRequests().length)}`);
        return { ok: false, reason: 'rate_limited', url };
      }
      const result = await attempt(url);
      const usage = used === null ? '' : `, ${usageLine(used)}`;
      log(`[bk] GET ${url} -> ${result.status ?? result.reason}${usage}`);

      if (!result.reason) {
        cache.set(url, { expires: now() + config.cacheTtlMs, data: result.data, status: result.status });
        return { ok: true, data: result.data, status: result.status, cached: false, url };
      }
      if (result.status === 429 && !waitedForTooManyRequests) {
        waitedForTooManyRequests = true;
        await sleep(config.tooManyRequestsWaitMs);
        continue;
      }
      const retryable = result.reason === 'timeout' || result.reason === 'network' || result.reason === 'http_5xx';
      if (retryable && retries < config.maxRetries) {
        await sleep(config.retryBackoffMs[retries] ?? config.retryBackoffMs.at(-1) ?? 1_000);
        retries++;
        continue;
      }
      return { ok: false, reason: result.reason, status: result.status, url };
    }
  }

  /** GET a path under the API base. Cached for 10 minutes by full URL; identical concurrent calls share one request. */
  async function get<T = unknown>(path: string, params?: BkParams): Promise<BkResult<T>> {
    const url = buildUrl(path, params);
    const hit = cache.get(url);
    if (hit && hit.expires > now()) {
      log(`[bk] cache hit ${url}`);
      return { ok: true, data: hit.data as T, status: hit.status, cached: true, url };
    }
    const pending = inFlight.get(url);
    if (pending) return pending as Promise<BkResult<T>>;

    // With the budget on, real requests run strictly one at a time.
    const run = rateLimit ? queue.then(() => fetchWithRetries(url)) : fetchWithRetries(url);
    if (rateLimit) queue = run.catch(() => undefined);
    inFlight.set(url, run);
    try {
      return (await run) as BkResult<T>;
    } finally {
      inFlight.delete(url);
    }
  }

  return {
    get,
    buildUrl,
    /** Real requests in the current rolling hour (0 when the budget is off). */
    usedThisHour: () => (rateLimit ? recentRequests().length : 0),
    clearCache: () => cache.clear(),
  };
}

export type BkClient = ReturnType<typeof createBkClient>;

let shared: BkClient | undefined;
/** Process-wide client so the cache and queue are shared by every caller. */
export function getBkClient(): BkClient {
  return shared ??= createBkClient();
}
