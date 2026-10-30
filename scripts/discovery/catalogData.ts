import { writeFileSync } from 'node:fs';
import { CLOTHING_CATEGORIES, VERTICALS, loadFixture } from './requests';

/* eslint-disable @typescript-eslint/no-explicit-any -- raw, unvalidated API JSON */

export const CATALOG_DATA_PATH = 'lib/catalog/bkCatalogData.json';
/** Offline copy of the store hierarchy (/menu): Ray's starting point and fallback, and test data. */
export const MENU_SNAPSHOT_PATH = 'lib/catalog/bkMenuSnapshot.json';

const named = (items: any[] | undefined) => (items ?? []).map(item => ({ slug: String(item.slug), name: String(item.name).trim() }));

/**
 * Builds the slug data Ray's catalog config uses (colours, brands, materials, product types,
 * attribute labels, gender mix, age coverage) from the saved facets and product responses.
 * Slugs are never typed by hand: refresh them with `npm run discover:bk -- --refresh`.
 */
export function writeCatalogData(): void {
  const verticals: Record<string, unknown> = {};
  for (const slug of VERTICALS) {
    const facets = (loadFixture(`facets-vertical-${slug}`) as any)?.availableFilters;
    const page = loadFixture(`vertical-${slug}`) as any;
    if (!facets || !page) continue;
    const cards: any[] = page.groups ?? [];
    const genders: Record<string, number> = {};
    for (const gender of facets.genders ?? []) genders[gender.value] = gender.count;
    verticals[slug] = {
      label: cards[0]?.vertical?.name ?? slug,
      totalCount: page.pagination?.totalCount ?? 0,
      genders,
      // Share of sampled cards that carry an age: the API drops cards without age when filtering by age.
      ageCoverage: cards.length ? Number((cards.filter(card => card.ageMonthsMin != null && card.ageMonthsMax != null).length / cards.length).toFixed(2)) : 0,
      productTypes: named(facets.productTypes),
      colors: (facets.colors ?? []).map((color: any) => ({ slug: String(color.slug), name: String(color.name).trim(), family: color.familySlug ?? null })),
      materials: named(facets.materials),
      brands: named(facets.brands),
    };
  }
  const categories: Record<string, unknown> = {};
  for (const slug of CLOTHING_CATEGORIES) {
    const facets = (loadFixture(slug === 'topwear' ? 'verify-facets-topwear' : `facets-clothing-${slug}`) as any)?.availableFilters;
    if (!facets) continue;
    const attributes: Record<string, string[]> = {};
    for (const attribute of facets.attributes ?? []) attributes[attribute.slug] = attribute.values.map((value: any) => String(value.value));
    categories[slug] = { productTypes: named(facets.productTypes), attributes };
  }
  const data = { source: 'fixtures/bk (facets and page 1 per vertical)', verticals, categories };
  writeFileSync(CATALOG_DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`Wrote ${CATALOG_DATA_PATH}.`);
  const menu = loadFixture('menu');
  if (menu) {
    writeFileSync(MENU_SNAPSHOT_PATH, JSON.stringify(menu) + '\n');
    console.log(`Wrote ${MENU_SNAPSHOT_PATH}.`);
  }
}
