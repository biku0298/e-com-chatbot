import { getBkClient, isBkFailure, type BkClient } from '../bk/client';
import { getPrisma } from '../prisma';
import { toRows } from './bkMenuRows';
import { parseMenu, type BkTaxonomy } from './bkTaxonomy';

export const MENU_SOURCE = 'menu';

export type MenuSyncResult = { taxonomy: BkTaxonomy; verticals: number; categories: number; productTypes: number; durationMs: number };

/**
 * Copy the store hierarchy from the bachpankart /menu endpoint into our database.
 * The whole tree is replaced in one transaction, so readers see either the old tree or the new
 * one, and anything the store removed disappears. Nothing is written if the response is invalid.
 */
export async function syncMenu(client: BkClient = getBkClient(), prisma = getPrisma()): Promise<MenuSyncResult> {
  const started = Date.now();
  const result = await client.get('menu');
  if (isBkFailure(result)) throw new Error(`Menu sync failed: ${result.reason}${result.status ? ` (HTTP ${result.status})` : ''}`);
  const syncedAt = new Date();
  const taxonomy = parseMenu(result.data, 'database', syncedAt.toISOString());
  const rows = toRows(taxonomy);
  const counts = { verticals: rows.verticals.length, categories: rows.categories.length, productTypes: rows.productTypes.length };

  // Generous waits: a sleeping (serverless) Postgres can take several seconds to wake up.
  await prisma.$transaction(async tx => {
    // Deleting the verticals cascades to their categories and product types.
    await tx.vertical.deleteMany();
    await tx.vertical.createMany({ data: rows.verticals });
    await tx.category.createMany({ data: rows.categories });
    await tx.productType.createMany({ data: rows.productTypes });
    await tx.catalogSync.upsert({
      where: { source: MENU_SOURCE },
      create: { source: MENU_SOURCE, syncedAt, ...counts },
      update: { syncedAt, ...counts },
    });
  }, { maxWait: 20_000, timeout: 60_000 });
  return { taxonomy, ...counts, durationMs: Date.now() - started };
}
