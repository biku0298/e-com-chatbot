/**
 * Copy the store hierarchy (verticals → categories → product types) from the bachpankart /menu
 * endpoint into our database now. Ray also does this by itself every BK_SYNC_INTERVAL_HOURS (5).
 *   npm run sync:bk
 */
import { syncMenu } from '../lib/catalog/bkMenuSync';
import { getPrisma } from '../lib/prisma';

async function main() {
  const result = await syncMenu();
  const empty = result.taxonomy.verticals.flatMap(vertical => vertical.categories).filter(category => !category.inStockCount).length;
  console.log(`Synced ${result.verticals} verticals, ${result.categories} categories (${empty} with nothing in stock), ${result.productTypes} product types in ${result.durationMs} ms.`);
}

main()
  .catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => getPrisma().$disconnect());
