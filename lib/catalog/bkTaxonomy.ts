import snapshot from './bkMenuSnapshot.json';

/**
 * The store hierarchy (vertical → category → product type) with in-stock counts, as served by
 * the bachpankart /api/consumer/menu endpoint. Ray keeps one current copy in memory: the bundled
 * snapshot at start, replaced by the database copy (kept in step by bkMenuSync) at runtime.
 * Pure: no database or network imports.
 */
export type BkStockCounts = { productCount: number; inStockCount: number; inStockBoys: number; inStockGirls: number };
export type BkTaxonomyProductType = { id: string; slug: string; name: string; displayOrder: number } & BkStockCounts;
export type BkTaxonomyCategory = { id: string; slug: string; name: string; displayOrder: number; imageUrl: string | null; productTypes: BkTaxonomyProductType[] } & BkStockCounts;
export type BkTaxonomyVertical = { id: string; slug: string; name: string; displayOrder: number; categories: BkTaxonomyCategory[] };
export type BkTaxonomy = { verticals: BkTaxonomyVertical[]; syncedAt: string | null; source: 'snapshot' | 'database' };

/* eslint-disable @typescript-eslint/no-explicit-any -- raw API JSON is validated field by field */
const text = (value: unknown, what: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid menu: ${what} must be a non-empty string`);
  return value.trim();
};
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const order = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const counts = (node: any): BkStockCounts => ({
  productCount: count(node.productCount),
  inStockCount: count(node.inStockCount),
  inStockBoys: count(node.inStockCounts?.boys),
  inStockGirls: count(node.inStockCounts?.girls),
});

/** Validate and normalize a /menu response. Throws on anything malformed (a sync must never store half a tree). */
export function parseMenu(json: unknown, source: BkTaxonomy['source'] = 'snapshot', syncedAt: string | null = null): BkTaxonomy {
  const verticals = (json as any)?.verticals;
  if (!Array.isArray(verticals) || !verticals.length) throw new Error('Invalid menu: no verticals');
  const seenCategories = new Set<string>();
  const parsed = verticals.map((vertical: any, vi: number): BkTaxonomyVertical => ({
    id: text(vertical?.id, 'vertical id'),
    slug: text(vertical?.slug, 'vertical slug'),
    name: text(vertical?.name, 'vertical name'),
    displayOrder: order(vertical?.displayOrder, vi),
    categories: (Array.isArray(vertical?.categories) ? vertical.categories : []).map((category: any, ci: number): BkTaxonomyCategory => {
      const slug = text(category?.slug, 'category slug');
      if (seenCategories.has(slug)) throw new Error(`Invalid menu: duplicate category slug ${slug}`);
      seenCategories.add(slug);
      const seenTypes = new Set<string>();
      return {
        id: text(category?.id, 'category id'),
        slug,
        name: text(category?.name, 'category name'),
        displayOrder: order(category?.displayOrder, ci),
        imageUrl: typeof category?.imageUrl === 'string' && category.imageUrl ? category.imageUrl : null,
        ...counts(category),
        productTypes: (Array.isArray(category?.productTypes) ? category.productTypes : [])
          .map((type: any, ti: number): BkTaxonomyProductType => ({
            id: text(type?.id, 'product type id'),
            slug: text(type?.slug, 'product type slug'),
            name: text(type?.name, 'product type name'),
            displayOrder: order(type?.displayOrder, ti),
            ...counts(type),
          }))
          // A product type appears once per category.
          .filter((type: BkTaxonomyProductType) => !seenTypes.has(type.slug) && seenTypes.add(type.slug)),
      };
    }),
  }));
  if (new Set(parsed.map(vertical => vertical.slug)).size !== parsed.length) throw new Error('Invalid menu: duplicate vertical slug');
  return { verticals: parsed, syncedAt, source };
}

// ── Current copy and lookups ───────────────────────────────────────────────────

type Indexes = {
  verticals: Map<string, BkTaxonomyVertical>;
  categories: Map<string, BkTaxonomyCategory & { vertical: string }>;
  /** Product types per vertical, one entry per slug (counts summed across categories). */
  typesByVertical: Map<string, Map<string, BkTaxonomyProductType>>;
};

let current: BkTaxonomy = parseMenu(snapshot, 'snapshot');
let indexes = buildIndexes(current);

function buildIndexes(taxonomy: BkTaxonomy): Indexes {
  const built: Indexes = { verticals: new Map(), categories: new Map(), typesByVertical: new Map() };
  for (const vertical of taxonomy.verticals) {
    built.verticals.set(vertical.slug, vertical);
    const types = new Map<string, BkTaxonomyProductType>();
    for (const category of vertical.categories) {
      built.categories.set(category.slug, { ...category, vertical: vertical.slug });
      for (const type of category.productTypes) {
        const seen = types.get(type.slug);
        types.set(type.slug, seen ? {
          ...seen,
          productCount: seen.productCount + type.productCount,
          inStockCount: seen.inStockCount + type.inStockCount,
          inStockBoys: seen.inStockBoys + type.inStockBoys,
          inStockGirls: seen.inStockGirls + type.inStockGirls,
        } : type);
      }
    }
    built.typesByVertical.set(vertical.slug, types);
  }
  return built;
}

/** The hierarchy Ray is currently using. */
export function getTaxonomy(): BkTaxonomy {
  return current;
}

/** Replace the hierarchy (the database copy at runtime; fixtures in tests). */
export function setTaxonomy(taxonomy: BkTaxonomy): void {
  current = taxonomy;
  indexes = buildIndexes(taxonomy);
}

export const taxonomyVertical = (slug: string | null | undefined) => (slug ? indexes.verticals.get(slug) : undefined);
export const taxonomyCategory = (slug: string | null | undefined) => (slug ? indexes.categories.get(slug) : undefined);
/** Product types of a vertical (unique slugs), in display order. */
export const taxonomyProductTypes = (vertical: string): BkTaxonomyProductType[] =>
  [...(indexes.typesByVertical.get(vertical)?.values() ?? [])];
export const taxonomyProductType = (vertical: string, slug: string) => indexes.typesByVertical.get(vertical)?.get(slug);
