import type { FacetCounts, FacetOption, Filters, ProductSearchResult } from '../chat/types';
import type { AttributeField } from '../config';
import { getBkClient, isBkFailure, type BkClient } from '../bk/client';
import { BK_PAGE_LIMIT, BK_SITE, bkCategory, bkVertical, verticalFiltersGender } from '../catalog/bkConfig';
import { CatalogUnavailableError } from '../catalog/errors';
import { ATTRIBUTE_API, filterList, toApiParams, toFacetParams } from './bkApiParams';

/** At most this many categories are searched for one overlapping word (one call each). */
const MAX_CATEGORY_CALLS = 2;

/** A product card as the bachpankart products API returns it (only the fields Ray uses). */
export type BkCard = {
  id: string;
  slug: string;
  name: string;
  brand?: { slug: string; name: string } | null;
  material?: { slug: string; name: string } | null;
  color?: { slug: string; name: string } | null;
  image: string;
  minPrice: number;
  maxPrice: number;
  minMrp?: number | null;
  discountPercent?: number | null;
  totalStock?: number | null;
  sizes?: { label: string }[];
  gender?: 'BOYS' | 'GIRLS' | 'UNISEX' | string;
  ageMonthsMin?: number | null;
  ageMonthsMax?: number | null;
  category?: { slug: string; name: string } | null;
  vertical?: { slug: string; name: string } | null;
};
type BkPage = { groups?: BkCard[]; pagination?: { totalCount?: number; hasNextPage?: boolean } };

/** API card → Ray product. Links and images come from API fields, never rebuilt from names. */
export function toRayProduct(card: BkCard): ProductSearchResult {
  const sizes = (card.sizes ?? []).map(size => size.label).filter(Boolean);
  const facet = (value?: { slug: string; name: string } | null) => (value?.slug ? { slug: value.slug, name: value.name?.trim() || value.slug } : undefined);
  const discounted = (card.discountPercent ?? 0) > 0 && card.minMrp != null && card.minMrp > card.minPrice;
  return {
    id: card.id,
    slug: card.slug,
    name: card.name,
    price: card.minPrice,
    maxPrice: card.maxPrice,
    mrp: discounted ? card.minMrp : null,
    discountPercent: discounted ? card.discountPercent! : 0,
    imageUrl: card.image,
    color: card.color?.name?.trim() ?? '',
    size: sizes.length > 1 ? `${sizes[0]} – ${sizes.at(-1)}` : sizes[0] ?? '',
    gender: card.gender?.toLowerCase(),
    type: card.category?.slug,
    category: card.category?.slug,
    brand: card.brand?.name,
    url: `${BK_SITE}/product/${encodeURIComponent(card.slug)}/${encodeURIComponent(card.id)}`,
    facets: {
      vertical: card.vertical?.slug ? { slug: card.vertical.slug, name: bkVertical(card.vertical.slug)?.label ?? card.vertical.name } : undefined,
      category: facet(card.category),
      color: facet(card.color),
      material: facet(card.material),
      brand: facet(card.brand),
    },
  };
}

/**
 * The website loosens filters when nothing matches; Ray must never show such results.
 * The API has not been seen doing this, but if a returned card breaks a filter we can check
 * from the card, the whole response is treated as "no matches".
 */
export function violatesFilters(card: BkCard, filters: Filters, category: string | null): string | null {
  const vertical = filters.vertical ?? bkCategory(category)?.vertical ?? null;
  if (vertical && card.vertical?.slug !== vertical) return 'vertical';
  if (category && card.category?.slug !== category) return 'category';
  const gender = filters.gender?.toUpperCase();
  if ((gender === 'BOYS' || gender === 'GIRLS') && (!vertical || verticalFiltersGender(vertical)) && card.gender !== gender && card.gender !== 'UNISEX') return 'gender';
  const inList = (value: string | undefined, list: string) => !filterList(list).length || (value != null && filterList(list).includes(value));
  if (!inList(card.color?.slug, filters.color ?? '')) return 'color';
  if (!inList(card.brand?.slug, filters.brand ?? '')) return 'brand';
  if (!inList(card.material?.slug, filters.material ?? '')) return 'material';
  if (filters.maxPrice != null && card.minPrice > filters.maxPrice) return 'price';
  // Age is not checked: the API matches age on the size variants, and the card's own age fields
  // are sometimes wrong (a frock sized 1-2y to 6-7y carries 48-84 months), so they cannot judge it.
  return null;
}

/**
 * Live product search with the same signature as the database `searchProducts`.
 * `query` is unused: free words travel as `filters.searchText` (the API's strict `q`).
 * Paging: the API serves pages of 24; Ray asks for any [skip, skip + take) window, and repeated
 * pages come from the client's cache, so "show more" usually costs no request.
 */
export function createBkLiveSearch(client: BkClient = getBkClient(), log: (message: string) => void = message => console.warn(message)) {
  async function fetchCategory(filters: Filters, category: string | null, fromPage: number, toPage: number): Promise<BkCard[]> {
    const cards: BkCard[] = [];
    for (let page = fromPage; page <= toPage; page++) {
      const result = await client.get<BkPage>('products', toApiParams(filters, { category, page }));
      if (isBkFailure(result)) throw new CatalogUnavailableError(result.reason);
      const groups = result.data?.groups ?? [];
      const broken = groups.map(card => violatesFilters(card, filters, category)).find(Boolean);
      if (broken) {
        log(`[bk] response contains products outside the filters (${broken}); treating as no matches: ${result.url}`);
        return [];
      }
      cards.push(...groups);
      if (!result.data?.pagination?.hasNextPage || groups.length < BK_PAGE_LIMIT) break;
    }
    return cards;
  }

  return async function searchBk(filters: Filters, _query?: string, skip = 0, take = BK_PAGE_LIMIT): Promise<ProductSearchResult[]> {
    const categories = filterList(filters.category).slice(0, MAX_CATEGORY_CALLS);
    const lastPage = Math.floor((skip + Math.max(take, 1) - 1) / BK_PAGE_LIMIT) + 1;
    let window: BkCard[];
    if (categories.length <= 1) {
      const firstPage = Math.floor(skip / BK_PAGE_LIMIT) + 1;
      const cards = await fetchCategory(filters, categories[0] ?? null, firstPage, lastPage);
      const offset = skip - (firstPage - 1) * BK_PAGE_LIMIT;
      window = cards.slice(offset, offset + take);
    } else {
      // One call per category, interleaved and de-duplicated by id (slugs are not unique).
      const lists = await Promise.all(categories.map(category => fetchCategory(filters, category, 1, lastPage)));
      const merged = new Map<string, BkCard>();
      for (let i = 0; i < Math.max(...lists.map(list => list.length)); i++) {
        for (const list of lists) if (list[i] && !merged.has(list[i].id)) merged.set(list[i].id, list[i]);
      }
      window = [...merged.values()].slice(skip, skip + take);
    }
    return window.filter(card => (card.totalStock ?? 1) > 0).map(toRayProduct);
  };
}

/** The facets endpoint's filter lists (only the parts Ray uses). */
type BkFacets = {
  availableFilters?: {
    productTypes?: { slug: string; name: string; count: number }[];
    attributes?: { slug: string; values: { value: string; count: number }[] }[];
  };
};
const FACET_TO_FIELD = Object.fromEntries(Object.entries(ATTRIBUTE_API).map(([field, api]) => [api.facet, field])) as Record<string, AttributeField>;

/** Facets response → counts per dimension that product cards do not carry (product type, attributes). */
export function toFacetCounts(data: BkFacets | undefined): FacetCounts {
  const counts: FacetCounts = {};
  const filters = data?.availableFilters;
  const types = (filters?.productTypes ?? []).filter(type => type.count > 0);
  if (types.length) counts.type = types.map(type => ({ value: type.slug, name: type.name.trim(), count: type.count }));
  for (const attribute of filters?.attributes ?? []) {
    const field = FACET_TO_FIELD[attribute.slug];
    // A comma inside a label would be read as two labels, so such values are left out.
    const values = attribute.values.filter(value => value.count > 0 && value.value.trim() && !value.value.includes(','));
    if (field && values.length) counts[field] = values.map(value => ({ value: value.value.trim(), name: value.value.trim(), count: value.count }));
  }
  return counts;
}

/** Add up counts from several facet calls (one per overlapping category). */
function mergeCounts(all: FacetCounts[]): FacetCounts {
  const merged: FacetCounts = {};
  for (const counts of all) {
    for (const [field, options] of Object.entries(counts) as [keyof FacetCounts, FacetOption[]][]) {
      const byValue = new Map((merged[field] ?? []).map(option => [option.value, { ...option }]));
      for (const option of options) {
        const existing = byValue.get(option.value);
        if (existing) existing.count += option.count;
        else byValue.set(option.value, { ...option });
      }
      merged[field] = [...byValue.values()];
    }
  }
  return merged;
}

/**
 * Filter counts for the current filters: one facets call, sent alongside the products call
 * (one per overlapping category). Returns null when the call fails: results still show, only
 * the product-type and attribute chips are skipped.
 */
export function createBkFacetSearch(client: BkClient = getBkClient()) {
  return async function searchFacets(filters: Filters): Promise<FacetCounts | null> {
    const categories = filterList(filters.category).slice(0, MAX_CATEGORY_CALLS);
    const results = await Promise.all((categories.length ? categories : [null]).map(category => client.get<BkFacets>('products/facets', toFacetParams(filters, { category }))));
    if (results.some(isBkFailure)) return null;
    return mergeCounts(results.map(result => toFacetCounts((result as { data: BkFacets }).data)));
  };
}
