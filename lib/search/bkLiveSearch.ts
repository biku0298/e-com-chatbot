import type { Filters, ProductSearchResult } from '../chat/types';
import { getBkClient, isBkFailure, type BkClient } from '../bk/client';
import { BK_PAGE_LIMIT, BK_SITE, bkCategory, bkVertical, verticalNeedsGender, verticalUsesAge } from '../catalog/bkConfig';
import { CatalogUnavailableError } from '../catalog/errors';
import { filterList, toApiParams } from './bkApiParams';

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
  if ((gender === 'BOYS' || gender === 'GIRLS') && (!vertical || verticalNeedsGender(vertical)) && card.gender !== gender && card.gender !== 'UNISEX') return 'gender';
  const inList = (value: string | undefined, list: string) => !filterList(list).length || (value != null && filterList(list).includes(value));
  if (!inList(card.color?.slug, filters.color ?? '')) return 'color';
  if (!inList(card.brand?.slug, filters.brand ?? '')) return 'brand';
  if (!inList(card.material?.slug, filters.material ?? '')) return 'material';
  if (filters.maxPrice != null && card.minPrice > filters.maxPrice) return 'price';
  if ((filters.ageMin != null || filters.ageMax != null) && (!vertical || verticalUsesAge(vertical))) {
    const min = (filters.ageMin ?? filters.ageMax!) * 12;
    const max = (filters.ageMax ?? filters.ageMin!) * 12;
    if (card.ageMonthsMin == null || card.ageMonthsMax == null || card.ageMonthsMax < min || card.ageMonthsMin > max) return 'age';
  }
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
