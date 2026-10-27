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
  /** Store department (bachpankart vertical). Unused by the fake catalog. */
  vertical?: string | null;
  /** Category slug. In the live catalog it may be a comma-joined list (overlapping words, searched separately). */
  category?: string | null;
  /** Product type (fake: dress/shirt…; live: the API's productType slug). */
  type?: string | null;
  gender?: string | null;
  maxPrice?: number | null;
  ageMin?: number | null;
  ageMax?: number | null;
  occasion?: string | null;
  /** Colour (fake: one word; live: comma-joined colour slugs). */
  color?: string | null;
  fit?: string | null;
  brand?: string | null;
  material?: string | null;
  /** Free search words the catalog could not map (the live API's `q`). */
  searchText?: string | null;
};

export type Intent = 'product' | 'policy' | 'general' | 'sizing';

export type SizingResult =
  | { action: 'ask'; reply: string }
  | { action: 'recommend'; reply: string; ageMin: number; ageMax: number; gender: string | null };

/** A catalog value with its display name (used for chips: labels are names, refinements are slugs). */
export type FacetValue = { slug: string; name: string };

export type ProductSearchResult = {
  /** Numeric in the fake catalog; the live catalog's ids are strings. Always key products by id. */
  id: number | string;
  name: string;
  /** Lowest price (₹). */
  price: number;
  imageUrl: string;
  color: string;
  size: string;
  gender?: string;
  type?: string;
  occasion?: string;
  fit?: string;
  category?: string;
  // Live catalog extras for product cards.
  brand?: string;
  /** Highest variant price, shown as a range when it differs from `price`. */
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
  | 'material'
  | 'brand';

export type FieldStatus = 'unknown' | 'known' | 'unimportant';

export type ShoppingState = {
  intent: Intent | null;

  // Requested product information
  /** Store department (live catalog only). */
  vertical: string | null;
  /** Live catalog: may be a comma-joined list of category slugs for overlapping words. */
  category: string | null;
  type: string | null;
  color: string | null;
  fit: string | null;
  occasion: string | null;
  maxPrice: number | null;
  /** Live catalog: comma-joined material / brand slugs. */
  material: string | null;
  brand: string | null;
  /** Live catalog: item words that matched no category (sent as the API's search text). */
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

