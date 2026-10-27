import assert from 'node:assert/strict';
import { createBkClient, isBkFailure, type BkClientOptions, type BkResult, type RequestLogStore } from '../lib/bk/client';

const reasonOf = (result: BkResult<unknown>) => (isBkFailure(result) ? result.reason : null);
const statusOf = (result: BkResult<unknown>) => result.status;

/** Fake clock, fake fetch and in-memory request log: these tests never touch the network. */
function harness(responses: (Response | Error | 'hang')[], options: Partial<BkClientOptions> = {}) {
  let time = 1_000_000;
  const saved: number[][] = [];
  let timestamps: number[] = [];
  const store: RequestLogStore = { load: () => [...timestamps], save: list => { timestamps = [...list]; saved.push(list); } };
  const calls: { url: string; at: number; headers: Headers }[] = [];
  const sleeps: number[] = [];
  const logs: string[] = [];
  let active = 0;
  let maxActive = 0;
  const queue = [...responses];
  const client = createBkClient({
    rateLimit: true,
    now: () => time,
    sleep: async ms => { sleeps.push(ms); time += ms; },
    store,
    log: message => logs.push(message),
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), at: time, headers: new Headers(init?.headers) });
      active++; maxActive = Math.max(maxActive, active);
      try {
        await new Promise(resolve => setImmediate(resolve));
        const next = queue.length > 1 ? queue.shift()! : queue[0];
        if (next === 'hang') {
          return await new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
        }
        if (next instanceof Error) throw next;
        return next.clone();
      } finally {
        active--;
      }
    }) as typeof fetch,
    ...options,
  });
  return {
    client, calls, sleeps, logs, saved,
    advance: (ms: number) => { time += ms; },
    preload: (list: number[]) => { timestamps = list; },
    get timestamps() { return timestamps; },
    get now() { return time; },
    get maxActive() { return maxActive; },
  };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

async function main() {
  // URL building: comma lists stay one param, labels are encoded, empty values dropped.
  const urlHarness = harness([json({})]);
  const url = urlHarness.client.buildUrl('products', { verticalSlug: 'clothing', genders: 'BOYS,UNISEX', neckType: 'Round Neck', q: undefined, page: 2 });
  assert.equal(url, 'https://api.bachpankart.com/api/consumer/products?verticalSlug=clothing&genders=BOYS%2CUNISEX&neckType=Round+Neck&page=2');

  // Success, User-Agent, cache hit, cache expiry.
  const cached = harness([json({ groups: [1] })]);
  const first = await cached.client.get('products', { verticalSlug: 'toys' });
  assert.deepEqual(first, { ok: true, data: { groups: [1] }, status: 200, cached: false, url: 'https://api.bachpankart.com/api/consumer/products?verticalSlug=toys' });
  assert.equal(cached.calls[0].headers.get('User-Agent'), 'BachpanKart-Ray (Innowinds)');
  const second = await cached.client.get('products', { verticalSlug: 'toys' });
  assert.equal(!isBkFailure(second) && second.cached, true);
  assert.equal(cached.calls.length, 1, 'repeat within 10 minutes costs no request');
  assert.ok(cached.logs.some(line => line.includes('cache hit')));
  assert.ok(cached.logs.some(line => line.includes('used 1 this hour (soft 100 / hard 300)')));
  cached.advance(10 * 60_000 + 1);
  await cached.client.get('products', { verticalSlug: 'toys' });
  assert.equal(cached.calls.length, 2, 'cache expires after 10 minutes');

  // One at a time, at least 1s apart, every request recorded.
  const spaced = harness([json({})]);
  await Promise.all(['a', 'b', 'c'].map(q => spaced.client.get('products', { q })));
  assert.equal(spaced.maxActive, 1, 'never more than one request in flight');
  assert.deepEqual(spaced.calls.map(call => call.at - spaced.calls[0].at), [0, 1000, 2000]);
  assert.equal(spaced.timestamps.length, 3);
  assert.equal(spaced.client.usedThisHour(), 3);

  // Identical concurrent calls share one request.
  const shared = harness([json({})]);
  await Promise.all([shared.client.get('products', { q: 'x' }), shared.client.get('products', { q: 'x' })]);
  assert.equal(shared.calls.length, 1);

  // Soft limit warns; hard cap refuses without a request; old timestamps fall out of the window.
  const soft = harness([json({})]);
  soft.preload(Array.from({ length: 100 }, (_, i) => soft.now - 3_600_000 + 10_000 + i));
  assert.equal((await soft.client.get('products')).ok, true);
  assert.ok(soft.logs.some(line => line.includes('WARNING') && line.includes('used 101 this hour')));
  const hard = harness([json({})]);
  hard.preload(Array.from({ length: 300 }, (_, i) => hard.now - 60_000 + i));
  assert.deepEqual(await hard.client.get('products'), { ok: false, reason: 'rate_limited', url: 'https://api.bachpankart.com/api/consumer/products' });
  assert.equal(hard.calls.length, 0);
  const expired = harness([json({})]);
  expired.preload(Array.from({ length: 300 }, (_, i) => expired.now - 3_600_001 - i));
  assert.equal((await expired.client.get('products')).ok, true, 'requests older than an hour do not count');
  assert.equal(expired.timestamps.length, 1, 'the persisted window is pruned');

  // 5xx, timeouts and network errors: 2 retries with backoff, each counted.
  const down = harness([json({}, 503)]);
  assert.deepEqual(await down.client.get('products'), { ok: false, reason: 'http_5xx', status: 503, url: 'https://api.bachpankart.com/api/consumer/products' });
  assert.equal(down.calls.length, 3);
  assert.deepEqual(down.sleeps, [1000, 2000], 'backoff 1s then 2s (the backoff already covers the 1s spacing)');
  assert.equal(down.timestamps.length, 3, 'retries count toward the budget');
  const recovers = harness([json({}, 502), json({ groups: [] })]);
  assert.equal((await recovers.client.get('products')).ok, true);
  assert.equal(recovers.calls.length, 2);
  const offline = harness([new TypeError('fetch failed')]);
  const unreachable = await offline.client.get('products');
  assert.equal(reasonOf(unreachable), 'network');
  assert.equal(offline.calls.length, 3);
  const slow = harness(['hang'], { config: { timeoutMs: 5 } });
  const timedOut = await slow.client.get('products');
  assert.equal(reasonOf(timedOut), 'timeout');
  assert.equal(slow.calls.length, 3);

  // 4xx stops immediately; 429 waits 30s once, then retries.
  const missing = harness([json({}, 404)]);
  const notFound = await missing.client.get('products');
  assert.equal(reasonOf(notFound), 'http_4xx');
  assert.equal(missing.calls.length, 1);
  const throttled = harness([json({}, 429), json({ groups: [] })]);
  assert.equal((await throttled.client.get('products')).ok, true);
  assert.ok(throttled.sleeps.includes(30_000));
  assert.equal(throttled.calls.length, 2);
  const stillThrottled = harness([json({}, 429)]);
  const refused = await stillThrottled.client.get('products');
  assert.equal(reasonOf(refused), 'http_4xx'); assert.equal(statusOf(refused), 429);
  assert.equal(stillThrottled.calls.length, 2, 'only one 30s wait for 429');

  // Malformed JSON is not retried.
  const garbled = harness([new Response('<html>', { status: 200 })]);
  const bad = await garbled.client.get('products');
  assert.equal(reasonOf(bad), 'bad_json');
  assert.equal(garbled.calls.length, 1);

  // Production chat traffic: no budget, no spacing, no log file, but still cached.
  const production = harness([json({})], { rateLimit: false });
  production.preload(Array.from({ length: 300 }, (_, i) => production.now - i));
  await Promise.all(['a', 'b'].map(q => production.client.get('products', { q })));
  assert.equal(production.calls.length, 2);
  assert.equal(production.maxActive, 2, 'users are not queued behind each other');
  assert.equal(production.saved.length, 0);
  assert.equal(production.client.usedThisHour(), 0);
  await production.client.get('products', { q: 'a' });
  assert.equal(production.calls.length, 2, 'cache still applies in production');

  console.log('Bachpankart client checks passed (URLs, cache, spacing, budget window, retries, 4xx/429, timeouts, production mode).');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
