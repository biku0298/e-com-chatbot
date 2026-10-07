import { Filters } from './types';

/**
 * Coerces all numeric fields in the raw Gemini JSON to actual JS numbers.
 * Gemini sometimes returns numbers as strings (e.g. "500" instead of 500).
 * This runs immediately after JSON.parse so the rest of the code can trust types.
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
    category: raw.category ?? null,
    type:     raw.type     ?? null,
    gender:   raw.gender   ?? null,
    occasion: raw.occasion ?? null,
    color:    raw.color    ?? null,
    maxPrice: raw.maxPrice != null ? toFloatOrNull(raw.maxPrice) : null,
    ageMin:   raw.ageMin != null ? toIntOrNull(raw.ageMin) : null,
    ageMax:   raw.ageMax != null ? toIntOrNull(raw.ageMax) : null,
  };
}
