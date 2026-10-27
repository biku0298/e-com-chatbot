import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBkClient, isBkFailure } from '../lib/bk/client';
import { writeDiscoveryReport } from './discovery/report';
import { FIXTURE_DIR, REQUESTS, loadFixture, loadIndex, type FixtureIndexEntry } from './discovery/requests';

/**
 * Catalog discovery for the live bachpankart API (53 requests on a fresh run).
 *   npm run discover:bk              fetch every request below and save raw responses as fixtures
 *   npm run discover:bk -- --offline rebuild the report from saved fixtures (zero requests)
 * Saved fixtures and definitive 4xx answers are reused unless --refresh is passed;
 * only network failures and timeouts are tried again.
 */
async function fetchAll(refresh: boolean): Promise<number> {
  // Scripts always run under the development budget.
  const client = createBkClient({ rateLimit: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const index = new Map(loadIndex().map(entry => [entry.name, entry]));
  let made = 0;
  for (const request of REQUESTS) {
    const previous = index.get(request.name);
    const answered = previous?.ok ? loadFixture(request.name) !== undefined : previous?.reason === 'http_4xx';
    if (!refresh && answered) {
      console.log(`skip ${request.name} (already answered)`);
      continue;
    }
    const before = client.usedThisHour();
    const result = await client.get(request.path, request.params);
    made += Math.max(0, client.usedThisHour() - before);
    const entry: FixtureIndexEntry = {
      name: request.name, url: result.url, purpose: request.purpose, ok: result.ok, status: result.status, fetchedAt: new Date().toISOString(),
    };
    if (isBkFailure(result)) {
      entry.reason = result.reason;
      console.warn(`FAILED ${request.name}: ${result.reason}`);
      if (result.reason === 'rate_limited') {
        index.set(request.name, entry);
        break;
      }
    } else {
      writeFileSync(join(FIXTURE_DIR, `${request.name}.json`), JSON.stringify(result.data, null, 2) + '\n');
    }
    index.set(request.name, entry);
  }
  writeFileSync(join(FIXTURE_DIR, 'index.json'), JSON.stringify([...index.values()], null, 2) + '\n');
  console.log(`Requests made this run: ${made}. Used this hour: ${client.usedThisHour()}.`);
  return made;
}

async function main() {
  const args = process.argv.slice(2);
  const made = args.includes('--offline') ? 0 : await fetchAll(args.includes('--refresh'));
  writeDiscoveryReport(made);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/discover-bachpankart.ts')) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
