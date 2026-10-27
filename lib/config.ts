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
 * `vertical`, `category`, `material` and `brand` are used by the live bachpankart catalog.
 */
export type FunnelField = 'vertical' | 'category' | 'type' | 'occasion' | 'color' | 'fit' | 'material' | 'brand';
/** Every field a chip may refine (request validation). */
export const REFINABLE_FIELDS: FunnelField[] = ['vertical', 'category', 'type', 'occasion', 'color', 'fit', 'material', 'brand'];
/**
 * Fake catalog funnel order. `type` only applies when a category is known but no specific type is.
 * The live catalog's funnel lives in lib/catalog/bkConfig.ts.
 */
export const FUNNEL_ORDER: FunnelField[] = ['type', 'occasion', 'color', 'fit'];
export const MAX_CHIPS = 3;

/** Chip text per attribute value (2–4 words). Unmapped values fall back to `funnelLabel` defaults. */
const FUNNEL_LABELS: Partial<Record<FunnelField, Record<string, string>>> = {
  type: {
    dress: 'Dresses',
    top: 'Tops',
    shirt: 'Shirts',
    shorts: 'Shorts',
    jeans: 'Jeans',
    skirt: 'Skirts',
  },
  occasion: {
    party: 'Party wear 🎉',
    ethnic: 'Ethnic & festive 🪷',
    casual: 'Casual wear 👕',
  },
  color: {
    blue: 'In blue',
  },
  fit: {
    slim: 'Slim fit',
    regular: 'Regular fit',
    relaxed: 'Relaxed fit',
  },
};

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
};

/** Removal chip text for the optional filters a zero-result reply may offer to drop. */
export const REMOVE_LABELS: Partial<Record<FunnelField, string>> = {
  occasion: 'Any occasion',
  color: 'Any color',
  fit: 'Any fit',
  material: 'Any material',
  brand: 'Any brand',
};

export function funnelLabel(field: FunnelField, value: string): string {
  const mapped = FUNNEL_LABELS[field]?.[value];
  if (mapped) return mapped;
  if (field === 'color') return `In ${value}`;
  const capitalized = value.charAt(0).toUpperCase() + value.slice(1);
  return field === 'fit' ? `${capitalized} fit` : capitalized;
}
