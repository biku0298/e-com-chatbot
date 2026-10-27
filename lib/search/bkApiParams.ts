import type { Filters } from '../chat/types';
import { ATTRIBUTE_FIELDS, type AttributeField } from '../config';
import { BK_PAGE_LIMIT, BK_SORT, attributeLabel, bkCategory, verticalNeedsGender, verticalUsesAge } from '../catalog/bkConfig';

/** Ray attribute field → the API's query param and its facet slug. */
export const ATTRIBUTE_API: Record<AttributeField, { param: string; facet: string }> = {
  occasion: { param: 'occasion', facet: 'occasion' },
  fit: { param: 'fit', facet: 'fit' },
  sleeveLength: { param: 'sleeveLength', facet: 'sleeve-length' },
  pattern: { param: 'pattern', facet: 'pattern' },
};

/** Split a comma-joined filter value into its parts. */
export function filterList(value: string | null | undefined): string[] {
  return (value ?? '').split(',').map(part => part.trim()).filter(Boolean);
}

/**
 * Ray filters → bachpankart query params (names from docs/bachpankart-api.md).
 * `category` picks ONE category: the API treats a comma-joined categorySlug as a single slug,
 * so overlapping categories are searched in separate calls.
 */
export function toApiParams(filters: Filters, options: { category?: string | null; page?: number } = {}): URLSearchParams {
  const params = new URLSearchParams();
  const category = options.category ?? (filterList(filters.category).length === 1 ? filterList(filters.category)[0] : null);
  const vertical = filters.vertical ?? bkCategory(category)?.vertical ?? null;
  const set = (key: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
  };

  set('verticalSlug', vertical);
  set('categorySlug', category);
  set('q', filters.searchText);

  // Gender: BOYS/GIRLS plus UNISEX, and only where gender varies (or the vertical is not known yet).
  const gender = filters.gender?.toLowerCase();
  if ((gender === 'boys' || gender === 'girls') && (!vertical || verticalNeedsGender(vertical))) {
    set('genders', `${gender.toUpperCase()},UNISEX`);
  }
  set('productTypes', filterList(filters.type).join(','));
  set('colors', filterList(filters.color).join(','));
  set('brands', filterList(filters.brand).join(','));
  set('materials', filterList(filters.material).join(','));

  // Attributes are display labels and case-sensitive; several labels mean "any of" (comma-joined).
  for (const field of ATTRIBUTE_FIELDS) {
    const labels = filterList(filters[field]);
    if (labels.length) set(ATTRIBUTE_API[field].param, labels.map(label => attributeLabel(category, ATTRIBUTE_API[field].facet, label) ?? label).join(','));
  }

  // Ages are whole years in Ray; the API matches age ranges by overlap in months.
  // Skip age where products carry none: the API would drop them all.
  if ((filters.ageMin != null || filters.ageMax != null) && (!vertical || verticalUsesAge(vertical))) {
    const min = filters.ageMin ?? filters.ageMax!;
    const max = filters.ageMax ?? filters.ageMin!;
    set('ageMonthsMin', Math.round(min * 12));
    set('ageMonthsMax', Math.round(max * 12));
  }
  // Price only when the customer asked; never a minimum or discount of our own.
  if (filters.maxPrice != null) set('priceMax', Math.floor(filters.maxPrice));

  set('sort', BK_SORT);
  set('limit', BK_PAGE_LIMIT);
  set('page', options.page ?? 1);
  return params;
}

/** Same filters for the facets endpoint (no sort or paging), so one cached call serves every page. */
export function toFacetParams(filters: Filters, options: { category?: string | null } = {}): URLSearchParams {
  const params = toApiParams(filters, options);
  for (const key of ['sort', 'limit', 'page']) params.delete(key);
  return params;
}
