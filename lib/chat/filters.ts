import { Filters } from './types';

/**
 * Normalizes the filters a client sends back with "show more": every known field is present,
 * missing ones are null, and numeric fields sent as strings ("500") become numbers.
 */
export function sanitizeFilters(raw: Record<string, any>): Filters {
  const toIntOrNull = (v: any): number | null => {
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  };
  const toFloatOrNull = (v: any): number | null => {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };
  return {
    vertical: raw.vertical ?? null,
    category: raw.category ?? null,
    type: raw.type ?? null,
    gender: raw.gender ?? null,
    occasion: raw.occasion ?? null,
    color: raw.color ?? null,
    fit: raw.fit ?? null,
    sleeveLength: raw.sleeveLength ?? null,
    pattern: raw.pattern ?? null,
    material: raw.material ?? null,
    brand: raw.brand ?? null,
    searchText: raw.searchText ?? null,
    maxPrice: raw.maxPrice != null ? toFloatOrNull(raw.maxPrice) : null,
    ageMin: raw.ageMin != null ? toIntOrNull(raw.ageMin) : null,
    ageMax: raw.ageMax != null ? toIntOrNull(raw.ageMax) : null,
  };
}
