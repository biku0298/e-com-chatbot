import { getPrisma } from '../prisma';
import { fromRows } from './bkMenuRows';
import { MENU_SOURCE, syncMenu } from './bkMenuSync';
import { getTaxonomy, setTaxonomy, type BkTaxonomy } from './bkTaxonomy';

/** How old the copied hierarchy may get before it is refreshed from the store (BK_SYNC_INTERVAL_HOURS, default 5). */
export const SYNC_INTERVAL_MS = (Number(process.env.BK_SYNC_INTERVAL_HOURS) || 5) * 60 * 60_000;
/** How often a running server re-reads the database (picks up syncs made by other servers). */
export const RELOAD_INTERVAL_MS = 10 * 60_000;
/** After a database error, try again this soon. */
const RETRY_MS = 60_000;

export type TaxonomyStoreDeps = {
  /** When the hierarchy was last synced, or null if never. */
  readSyncedAt(): Promise<Date | null>;
  /** The hierarchy currently in the database. */
  readTaxonomy(syncedAt: Date): Promise<BkTaxonomy>;
  /** Copy the hierarchy from the store into the database; returns what was written. */
  sync(): Promise<BkTaxonomy>;
  now?: () => number;
  log?: (message: string) => void;
};

/**
 * Keeps Ray's in-memory hierarchy in step with the database copy, and the database copy in step
 * with the store. A chat never waits for a refresh (it runs in the background) and never fails
 * because of the database: the last good copy (or the bundled snapshot) stays in use.
 */
export function createTaxonomyStore(deps: TaxonomyStoreDeps) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((message: string) => console.warn(message));
  let nextLoadAt = 0;
  let loading: Promise<void> | undefined;
  let syncing: Promise<void> | undefined;

  function syncInBackground(): Promise<void> {
    syncing ??= deps.sync()
      .then(taxonomy => { setTaxonomy(taxonomy); })
      .catch(error => { log(`[catalog] hierarchy sync failed; keeping the current copy: ${error instanceof Error ? error.message : error}`); })
      .finally(() => { syncing = undefined; });
    return syncing;
  }

  async function load(): Promise<void> {
    try {
      const syncedAt = await deps.readSyncedAt();
      if (!syncedAt) {
        // Empty database (first run): fill it before answering.
        await syncInBackground();
      } else {
        setTaxonomy(await deps.readTaxonomy(syncedAt));
        if (now() - syncedAt.getTime() >= SYNC_INTERVAL_MS) void syncInBackground();
      }
      nextLoadAt = now() + RELOAD_INTERVAL_MS;
    } catch (error) {
      log(`[catalog] could not read the hierarchy from the database; using the ${getTaxonomy().source} copy: ${error instanceof Error ? error.message : error}`);
      nextLoadAt = now() + RETRY_MS;
    }
  }

  return {
    /** Make sure the hierarchy is loaded and not too old. Cheap when it is fresh. */
    async ensure(): Promise<void> {
      if (now() < nextLoadAt) return;
      loading ??= load().finally(() => { loading = undefined; });
      await loading;
    },
    /** Force a sync now (used by the sync script). */
    syncNow: () => syncInBackground(),
  };
}

let defaultStore: ReturnType<typeof createTaxonomyStore> | undefined;

/** The process-wide store, backed by our Postgres (Prisma) and the bachpankart API. */
export function ensureTaxonomy(): Promise<void> {
  defaultStore ??= createTaxonomyStore({
    async readSyncedAt() {
      const row = await getPrisma().catalogSync.findUnique({ where: { source: MENU_SOURCE } });
      return row?.syncedAt ?? null;
    },
    async readTaxonomy(syncedAt) {
      const tree = await getPrisma().vertical.findMany({ include: { categories: { include: { productTypes: true } } } });
      return fromRows(tree, syncedAt);
    },
    sync: async () => (await syncMenu()).taxonomy,
  });
  return defaultStore.ensure();
}
