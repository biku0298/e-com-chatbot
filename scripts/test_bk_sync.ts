import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromRows, toRows, type VerticalTree } from '../lib/catalog/bkMenuRows';
import { getTaxonomy, parseMenu, setTaxonomy, type BkTaxonomy } from '../lib/catalog/bkTaxonomy';
import { RELOAD_INTERVAL_MS, SYNC_INTERVAL_MS, createTaxonomyStore } from '../lib/catalog/bkTaxonomyStore';

/** Hierarchy copy: row mapping and the refresh rules. No database or network (fakes stand in). */
const HOUR = 60 * 60_000;
const menu = JSON.parse(readFileSync('fixtures/bk/menu.json', 'utf8'));
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

/** What Prisma's findMany(include categories → productTypes) returns for these rows. */
function treeOf(taxonomy: BkTaxonomy): VerticalTree[] {
  const rows = toRows(taxonomy);
  return rows.verticals.map(vertical => ({
    ...vertical,
    categories: rows.categories.filter(c => c.verticalId === vertical.id).map(category => ({
      ...category,
      productTypes: rows.productTypes.filter(t => t.categoryId === category.id),
    })),
  }));
}

async function main() {
  // ── Rows ↔ hierarchy ──
  const parsed = parseMenu(menu, 'database', '2026-10-30T08:00:00.000Z');
  const rows = toRows(parsed);
  assert.deepEqual([rows.verticals.length, rows.categories.length], [14, 105]);
  assert.ok(rows.productTypes.length > 300);
  assert.equal(new Set(rows.productTypes.map(t => `${t.categoryId}/${t.slug}`)).size, rows.productTypes.length, 'unique per category, as the table requires');
  assert.ok(rows.categories.every(c => rows.verticals.some(v => v.id === c.verticalId)));
  const shuffled = treeOf(parsed).reverse().map(v => ({ ...v, categories: [...v.categories].reverse() }));
  assert.deepEqual(fromRows(shuffled, new Date('2026-10-30T08:00:00.000Z')), parsed, 'database rows read back as the same hierarchy, in display order');

  // ── Refresh rules (fake database, fake clock) ──
  const snapshot = getTaxonomy();
  let clock = Date.parse('2026-10-30T12:00:00Z');
  const fresh = (hoursOld: number) => new Date(clock - hoursOld * HOUR);
  const harness = (options: { syncedAt: Date | null; failRead?: boolean; failSync?: boolean; slowSync?: boolean }) => {
    const calls: string[] = [];
    const logs: string[] = [];
    let releaseSync = () => {};
    const store = createTaxonomyStore({
      now: () => clock,
      log: message => logs.push(message),
      async readSyncedAt() { calls.push('readSyncedAt'); if (options.failRead) throw new Error('db down'); return options.syncedAt; },
      async readTaxonomy(syncedAt) { calls.push('readTaxonomy'); return fromRows(treeOf(parsed), syncedAt); },
      async sync() {
        calls.push('sync');
        if (options.slowSync) await new Promise<void>(resolve => { releaseSync = resolve; });
        if (options.failSync) throw new Error('api down');
        return parseMenu(menu, 'database', new Date(clock).toISOString());
      },
    });
    return { store, calls, logs, release: () => releaseSync() };
  };

  // Empty database (first run): fill it before answering.
  setTaxonomy(snapshot);
  const first = harness({ syncedAt: null });
  await first.store.ensure();
  assert.deepEqual(first.calls, ['readSyncedAt', 'sync']);
  assert.equal(getTaxonomy().source, 'database');

  // Fresh copy: read it, no sync; within 10 minutes no further reads.
  setTaxonomy(snapshot);
  const recent = harness({ syncedAt: fresh(1) });
  await recent.store.ensure();
  assert.deepEqual(recent.calls, ['readSyncedAt', 'readTaxonomy']);
  assert.equal(getTaxonomy().source, 'database');
  clock += RELOAD_INTERVAL_MS - 1;
  await recent.store.ensure();
  assert.equal(recent.calls.length, 2, 'cheap while fresh');
  clock += 2;
  await recent.store.ensure();
  assert.deepEqual(recent.calls.slice(2), ['readSyncedAt', 'readTaxonomy'], 're-reads the database every 10 minutes');

  // Older than 5 hours: answer with the current copy, refresh in the background.
  setTaxonomy(snapshot);
  const stale = harness({ syncedAt: fresh(SYNC_INTERVAL_MS / HOUR + 0.1), slowSync: true });
  await stale.store.ensure();
  assert.deepEqual(stale.calls, ['readSyncedAt', 'readTaxonomy', 'sync'], 'the chat does not wait for the sync');
  const before = getTaxonomy();
  stale.release();
  await settle(); await settle();
  assert.notEqual(getTaxonomy(), before, 'the refreshed hierarchy replaces the old one when the sync lands');
  assert.equal(SYNC_INTERVAL_MS, 5 * HOUR, 'default interval is 5 hours');

  // Database unreachable: keep the current copy, log, retry a minute later.
  setTaxonomy(snapshot);
  const down = harness({ syncedAt: fresh(1), failRead: true });
  await down.store.ensure();
  assert.equal(getTaxonomy(), snapshot);
  assert.ok(down.logs.some(line => line.includes('could not read the hierarchy') && line.includes('snapshot')));
  await down.store.ensure();
  assert.equal(down.calls.length, 1, 'no hammering while down');
  clock += 61_000;
  await down.store.ensure();
  assert.equal(down.calls.length, 2, 'retries after a minute');

  // Sync failure: keep the current copy.
  setTaxonomy(snapshot);
  const broken = harness({ syncedAt: null, failSync: true });
  await broken.store.ensure();
  assert.equal(getTaxonomy(), snapshot);
  assert.ok(broken.logs.some(line => line.includes('sync failed') && line.includes('api down')));

  // Simultaneous chats share one load.
  const busy = harness({ syncedAt: fresh(1) });
  await Promise.all([busy.store.ensure(), busy.store.ensure(), busy.store.ensure()]);
  assert.deepEqual(busy.calls, ['readSyncedAt', 'readTaxonomy']);

  setTaxonomy(snapshot);
  console.log('Hierarchy sync checks passed (row mapping, first fill, 10-min re-read, 5-hour refresh in background, database/API failures, shared loads).');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
