import { FUNNEL_ORDER, FUNNEL_QUESTIONS, MAX_CHIPS, REMOVE_LABELS, funnelLabel, type FunnelField } from '../config';
import type { ProductSearchResult, ShoppingState, Suggestion } from './types';
import { toSearchFilters } from './conversationState';

/*
 * Pure chip and template-reply helpers for the fake catalog (no model or database imports,
 * so the engine can use them and stay free of AI/DB code).
 */

/** Funnel fields still open for narrowing: not set, not marked unimportant, `type` only under a bare category. */
function remainingFunnelFields(state: ShoppingState): FunnelField[] {
  return FUNNEL_ORDER.filter(field =>
    state[field] == null &&
    !state.unimportantFields.includes(field) &&
    (field !== 'type' || state.category != null)
  );
}

/** Only values already in normalized form are used, so the refined SQL equality matches the source product. */
function funnelValue(product: ProductSearchResult, field: FunnelField): string | null {
  const value = product[field];
  if (typeof value !== 'string' || !value || value.length > 50 || value !== value.trim().toLowerCase()) return null;
  return value;
}

/**
 * Builds refinement chips from attribute values present in the products just returned.
 * Each chip's filters (current filters + one value) are satisfied by at least one of those
 * products, so a chip can never lead to an empty result, and no extra query is needed.
 */
export function buildFunnelChips(
  state: ShoppingState,
  products: ProductSearchResult[]
): { chips: Suggestion[]; nextRefinement: FunnelField | null } {
  for (const field of remainingFunnelFields(state)) {
    const counts = new Map<string, number>();
    for (const product of products) {
      const value = funnelValue(product, field);
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    if (counts.size < 2) continue;
    // Stable sort keeps first-seen order for equal frequencies.
    const chips = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_CHIPS)
      .map(([value]) => ({ label: funnelLabel(field, value), refine: { [field]: value } }));
    return { chips, nextRefinement: field };
  }
  return { chips: [], nextRefinement: null };
}

/** Zero-result chips: only offer to drop optional filters the customer set. Never price, gender, age or type. */
export function buildRemoveChips(state: ShoppingState): Suggestion[] {
  const filters = toSearchFilters(state);
  return FUNNEL_ORDER
    .filter(field => REMOVE_LABELS[field] && filters[field])
    .map(field => ({ label: REMOVE_LABELS[field]!, remove: [field] }));
}

/** Human description of the active filters, e.g. "red party dresses for girls under ₹500 for age 4". */
export function describeFilters(state: ShoppingState): string {
  const filters = toSearchFilters(state);
  const item = filters.type ? funnelLabel('type', filters.type).toLowerCase() : filters.category ?? 'items';
  const age = filters.ageMin != null && filters.ageMax != null && filters.ageMin !== filters.ageMax
    ? `for ages ${filters.ageMin}–${filters.ageMax}`
    : filters.ageMin != null ? `for age ${filters.ageMin}` : null;
  return [
    filters.color,
    filters.occasion,
    filters.fit ? `${filters.fit}-fit` : null,
    item,
    filters.gender ? `for ${filters.gender}` : null,
    filters.maxPrice != null ? `under ₹${filters.maxPrice}` : null,
    age,
  ].filter(Boolean).join(' ');
}

export type RefinementPrompt = { nextRefinement: FunnelField | null; labels: string[] };

/** Template reply used for pagination and whenever Gemini is unavailable. */
export function templateReply(intro: string, refinement: RefinementPrompt): string {
  return refinement.nextRefinement ? `${intro} ${FUNNEL_QUESTIONS[refinement.nextRefinement]}` : intro;
}
