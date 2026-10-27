import type { FunnelField } from '../config';
import type { ProductSearchResult, ShoppingField, ShoppingState, ShoppingStateUpdate, Suggestion } from '../chat/types';

/**
 * Everything that differs between product catalogs. The engine and the conversation decision
 * only talk to this interface, so swapping the fake database for the live bachpankart API is a
 * runtime choice (CATALOG_SOURCE), not an engine change. Implementations must stay pure:
 * no database, network or model imports.
 */
export interface Catalog {
  id: 'fake' | 'bk_live';

  // ── Understanding the customer ──
  /** Catalog description and normalisation rules for the extraction prompt. */
  promptCatalog: string;
  /** When search is allowed, phrased for the model. */
  promptSearchRule: string;
  /** JSON shape of the model's `extracted` object. */
  extractionShape: string;
  /**
   * Live catalog: map the customer's words (and the model's extraction) to catalog fields.
   * When present it replaces the fake catalog's item/colour detection. `replacesItem` means the
   * customer switched to a different item, so the previous item fields are cleared first.
   */
  resolveItem?(message: string, extracted: Record<string, unknown> | null, current: ShoppingState): { update: ShoppingStateUpdate; replacesItem: boolean };
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
   * Refinement chips built only from the products just returned (no extra calls).
   * `complete` is true when `sample` holds every match.
   */
  buildChips(state: ShoppingState, sample: ProductSearchResult[], info: { complete: boolean }): { chips: Suggestion[]; nextRefinement: FunnelField | null };
  /** Zero-result chips: only remove optional filters the customer set. */
  removeChips(state: ShoppingState): Suggestion[];
  /** "red party dresses for girls under ₹500 for age 4" */
  describe(state: ShoppingState): string;
}
