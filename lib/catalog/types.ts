import type { FunnelField } from '../config';
import type { FacetCounts, ProductSearchResult, ShoppingField, ShoppingState, ShoppingStateUpdate, Suggestion } from '../chat/types';

/**
 * The store's catalog rules: what to ask, how words map to filters, and how chips narrow.
 * The engine and the conversation decision only talk to this interface, so they stay free of
 * catalog details and are testable with fakes. Implementations must stay pure: no database,
 * network or model imports.
 */
export interface Catalog {

  // ── Understanding the customer ──
  /** Catalog description and normalisation rules for the extraction prompt. */
  promptCatalog: string;
  /** When search is allowed, phrased for the model. */
  promptSearchRule: string;
  /** JSON shape of the model's `extracted` object. */
  extractionShape: string;
  /**
   * Map the customer's words (and the model's extraction) to catalog fields. `replacesItem` means
   * the customer switched to a different item, so the previous item fields are cleared first.
   */
  resolveItem(message: string, extracted: Record<string, unknown> | null, current: ShoppingState): { update: ShoppingStateUpdate; replacesItem: boolean };
  /** Required fields still missing before a search, in the order to ask them. */
  missingFields(state: ShoppingState): ShoppingField[];
  /** False: always ask the catalog's own questions, never the model's (default true). */
  useModelQuestion?: boolean;
  /** Question (and answer chips) for a missing field when the model gives none. */
  fallbackQuestion(field: ShoppingField): { question: string; suggestions: string[] };
  /** Intent routing: true when the message names something this catalog sells. */
  isProductMessage?(message: string): boolean;

  // ── Presenting results ──
  /** Text passed to `searchProducts` as the query. */
  searchQuery(state: ShoppingState, message: string, isChip: boolean): string;
  /**
   * Refinement chips built from the products just returned and the filter counts fetched with
   * them (no further calls). `complete` is true when `sample` holds every match.
   */
  buildChips(state: ShoppingState, sample: ProductSearchResult[], info: { complete: boolean; facets?: FacetCounts | null }): { chips: Suggestion[]; nextRefinement: FunnelField | null };
  /** Zero-result chips: only remove optional filters the customer set. */
  removeChips(state: ShoppingState): Suggestion[];
  /** "red party dresses for girls under ₹500 for age 4" */
  describe(state: ShoppingState): string;
}
