/**
 * Store-specific branding and identity configuration.
 * Centralized here to keep conversational AI logic portable across different store environments.
 */
export const STORE_CONFIG = {
  storeName: 'Bachpankart',
  assistantName: 'Ray',
  storeDescription: "a premium Indian kids' clothing and products store",
  assistantRole: 'Your AI shopping assistant',
} as const;

/** Products per results batch (first page and every "show more" page). */
export const PAGE_SIZE = 6;

/**
 * Rows fetched per results query (same single query, larger LIMIT). The first PAGE_SIZE are shown;
 * the rest only tell us whether another page exists and give chips a wider sample to choose from.
 * Must be greater than PAGE_SIZE.
 */
export const CHIP_SAMPLE_SIZE = 24;

/**
 * Attributes refinement chips can narrow by. Price, gender and age are never chips.
 */
export type FunnelField = 'vertical' | 'category' | 'type' | 'occasion' | 'color' | 'fit' | 'sleeveLength' | 'pattern' | 'material' | 'brand';
/** Every field a chip may refine (request validation). */
export const REFINABLE_FIELDS: FunnelField[] = ['vertical', 'category', 'type', 'occasion', 'color', 'fit', 'sleeveLength', 'pattern', 'material', 'brand'];
/** Clothing attributes: display labels, case-sensitive in the API, comma-joined for "any of". */
export const ATTRIBUTE_FIELDS = ['occasion', 'fit', 'sleeveLength', 'pattern'] as const;
export type AttributeField = typeof ATTRIBUTE_FIELDS[number];
export const MAX_CHIPS = 3;

/** Closing question for a results reply when the next chips narrow by this field. */
export const FUNNEL_QUESTIONS: Record<FunnelField, string> = {
  vertical: 'What kind of thing are you shopping for?',
  category: 'Which kind would you like?',
  type: 'Which kind would you like?',
  material: 'Any material you prefer?',
  brand: 'Any favourite brand?',
  occasion: 'Any particular style in mind?',
  color: 'Any colour you prefer?',
  fit: 'Any preferred fit?',
  sleeveLength: 'Any sleeve length you prefer?',
  pattern: 'Any pattern you like?',
};

/** Removal chip text for the optional filters a zero-result reply may offer to drop. */
export const REMOVE_LABELS: Partial<Record<FunnelField, string>> = {
  occasion: 'Any occasion',
  color: 'Any color',
  fit: 'Any fit',
  sleeveLength: 'Any sleeve',
  pattern: 'Any pattern',
  material: 'Any material',
  brand: 'Any brand',
};
