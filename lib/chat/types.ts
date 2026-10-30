import type { FunnelField } from '../config';

export type { FunnelField };

export type HistoryMessage = {
  sender: 'user' | 'bot';
  text: string;
};

/** JSON transport shared by the assistant engine and replaceable clients. */
export type ChatRequest = {
  message: string;
  history?: HistoryMessage[];
  shoppingState?: ShoppingState;
  /** Structured chip click: add these funnel filters to the current state. */
  refine?: Partial<Record<FunnelField, string>>;
  /** Structured chip click: clear these optional funnel filters. */
  remove?: FunnelField[];
};

/**
 * A follow-up chip. `refine` adds a filter, `remove` clears optional filters;
 * a label-only chip is sent as plain text.
 */
export type Suggestion = {
  label: string;
  refine?: Partial<Record<FunnelField, string>>;
  remove?: FunnelField[];
};

export type MoreRequest = {
  filters?: Filters;
  originalQuery?: string;
  skip?: number;
  history?: HistoryMessage[];
  shoppingState?: ShoppingState;
};

export type MoreResponse = {
  reply: string;
  products: ProductSearchResult[];
  suggestions: Suggestion[];
  shoppingState: ShoppingState;
  /** Attribute the refinement chips narrow by, if any. */
  nextRefinement?: FunnelField | null;
  /** False when this batch was the last one for these filters. */
  hasMore?: boolean;
};

export type ChatResponse = MoreResponse & {
  action: 'ask' | 'search' | 'policy' | 'general';
  readyForSearch: boolean;
  filters: Filters;
  searchQuery?: string;
  isPolicy?: boolean;
  isSizing?: boolean;
};

export type Filters = {
  /** Store department (bachpankart vertical). */
  vertical?: string | null;
  /** Category slug, or a comma-joined list for overlapping words (searched as separate calls). */
  category?: string | null;
  /** The API's productType slug. */
  type?: string | null;
  gender?: string | null;
  maxPrice?: number | null;
  ageMin?: number | null;
  ageMax?: number | null;
  occasion?: string | null;
  /** Comma-joined colour slugs. */
  color?: string | null;
  /** Clothing attributes: display labels exactly as the API spells them, comma-joined for "any of". */
  fit?: string | null;
  sleeveLength?: string | null;
  pattern?: string | null;
  brand?: string | null;
  material?: string | null;
  /** Free search words the catalog could not map (the API's `q`). */
  searchText?: string | null;
};

export type Intent = 'product' | 'policy' | 'general' | 'sizing';

export type SizingResult =
  | { action: 'ask'; reply: string }
  | { action: 'recommend'; reply: string; ageMin: number; ageMax: number; gender: string | null };

/** A catalog value with its display name (used for chips: labels are names, refinements are slugs). */
export type FacetValue = { slug: string; name: string };

/** One option from the store's filter counts for the current filters (the facets endpoint). */
export type FacetOption = { value: string; name: string; count: number };
/** Filter counts for dimensions product cards do not carry: product type and clothing attributes. */
export type FacetCounts = Partial<Record<'type' | 'occasion' | 'fit' | 'sleeveLength' | 'pattern', FacetOption[]>>;

export type ProductSearchResult = {
  /** The store's product (colour variant) id. Always key products by id: slugs are not unique. */
  id: string;
  name: string;
  /** Lowest price (₹). */
  price: number;
  imageUrl: string;
  color: string;
  size: string;
  gender?: string;
  type?: string;
  category?: string;
  brand?: string;
  /** Highest variant price (kept for data; the UI only shows the lowest `price`). */
  maxPrice?: number;
  /** MRP before discount, shown struck through. */
  mrp?: number | null;
  discountPercent?: number;
  /** Product page on the store. */
  url?: string;
  /** Slug + display name per funnel dimension, so chips need no extra lookups. */
  facets?: Partial<Record<'vertical' | 'category' | 'color' | 'material' | 'brand', FacetValue>>;
};

export type PolicyChunkSearchResult = {
  heading: string | null;
  content: string;
};

export type ShoppingField =
  | 'vertical'
  | 'category'
  | 'type'
  | 'gender'
  | 'age'
  | 'occasion'
  | 'color'
  | 'maxPrice'
  | 'fit'
  | 'sleeveLength'
  | 'pattern'
  | 'material'
  | 'brand';

export type ShoppingState = {
  intent: Intent | null;

  // Requested product information
  /** Store department (bachpankart vertical). */
  vertical: string | null;
  /** May be a comma-joined list of category slugs for overlapping words. */
  category: string | null;
  type: string | null;
  color: string | null;
  fit: string | null;
  sleeveLength: string | null;
  pattern: string | null;
  occasion: string | null;
  maxPrice: number | null;
  /** Comma-joined material / brand slugs. */
  material: string | null;
  brand: string | null;
  /** Item words that matched no category (sent as the API's search text). */
  searchText: string | null;

  // Known customer / recipient information
  gender: string | null;
  ageMin: number | null;
  ageMax: number | null;

  // Attributes explicitly indicated as not important / does not matter
  unimportantFields: ShoppingField[];

  // Missing information needed before search
  missingFields: ShoppingField[];

  // Search readiness flag
  isReadyForSearch: boolean;
};

export type ShoppingStateUpdate = {
  intent?: Intent | null;
  vertical?: string | null;
  category?: string | null;
  type?: string | null;
  gender?: string | null;
  ageMin?: number | null;
  ageMax?: number | null;
  age?: number | { min?: number | null; max?: number | null } | null;
  occasion?: string | null;
  color?: string | null;
  maxPrice?: number | string | null;
  fit?: string | null;
  sleeveLength?: string | null;
  pattern?: string | null;
  material?: string | null;
  brand?: string | null;
  searchText?: string | null;
  unimportantFields?: ShoppingField[];
};

export type DecisionAction = 'ask' | 'search';

export type ConversationDecision = {
  action: DecisionAction;
  reply: string;
  extractedUpdates: ShoppingStateUpdate;
  updatedState: ShoppingState;
  missingFields: ShoppingField[];
  canSearch: boolean;
  suggestions?: string[];
};

export type SuggestionContext = {
  shoppingState?: ShoppingState | null;
  filters?: Filters | null;
  originalQuery?: string | null;
  offset?: number;
  pageSize?: number;
  products?: ProductSearchResult[];
};

