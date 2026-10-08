import {
  Filters,
  FieldStatus,
  ShoppingField,
  ShoppingState,
  ShoppingStateUpdate,
} from './types';

export const KNOWN_TYPES = ['shirt', 'top', 'shorts', 'jeans', 'skirt', 'dress'] as const;

/**
 * Creates a fresh, clean conversation state for a new shopping inquiry.
 * All shopping attributes are initialized to unknown (null), with no
 * hardcoded preferences, marked as not yet ready for product search.
 */
export function createInitialShoppingState(): ShoppingState {
  const state: ShoppingState = {
    intent: null,
    category: null,
    type: null,
    gender: null,
    ageMin: null,
    ageMax: null,
    occasion: null,
    color: null,
    maxPrice: null,
    fit: null,
    unimportantFields: [],
    missingFields: [],
    isReadyForSearch: false,
  };
  state.missingFields = calculateMissingFields(state);
  return state;
}

/**
 * Normalizes string values: trims, lowercases, and maps empty or sentinel
 * strings to null.
 */
export function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const str = value.trim().toLowerCase();
  if (!str || str === 'null' || str === 'undefined') return null;
  return str;
}

/**
 * Normalizes price inputs from numbers or common string representations.
 * Handles numbers, strings, 'k' multipliers, and word phrases (e.g. "a thousand" -> 1000).
 */
export function normalizePrice(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    return !Number.isFinite(value) || value <= 0 ? null : Math.round(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null;

    if (trimmed.includes('one thousand') || trimmed.includes('a thousand')) return 1000;
    if (trimmed.includes('two thousand')) return 2000;
    if (trimmed.includes('three thousand')) return 3000;
    if (trimmed.includes('five hundred')) return 500;

    const kMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*k\b/i);
    if (kMatch) {
      return Math.round(parseFloat(kMatch[1]) * 1000);
    }

    const numMatch = trimmed.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
    if (numMatch) {
      const parsed = parseFloat(numMatch[1]);
      return isNaN(parsed) || parsed <= 0 ? null : Math.round(parsed);
    }
  }
  return null;
}

/**
 * Normalizes age representation, accepting a single integer age,
 * an age range, or an object with min/max properties.
 */
export function normalizeAge(
  ageInput?: unknown,
  ageMinInput?: unknown,
  ageMaxInput?: unknown
): { ageMin: number | null; ageMax: number | null } {
  const toInt = (val: unknown): number | null => {
    if ((typeof val !== 'number' && typeof val !== 'string') || val === '') return null;
    const n = Number(val);
    return !Number.isFinite(n) || n < 0 ? null : Math.round(n);
  };

  if (typeof ageInput === 'number' && Number.isFinite(ageInput) && ageInput >= 0) {
    const single = Math.round(ageInput);
    return { ageMin: single, ageMax: single };
  }

  if (typeof ageInput === 'object' && ageInput !== null) {
    const obj = ageInput as { min?: unknown; max?: unknown };
    const min = toInt(obj.min);
    const max = toInt(obj.max);
    if (min != null && max != null) {
      return { ageMin: Math.min(min, max), ageMax: Math.max(min, max) };
    }
    if (min != null) return { ageMin: min, ageMax: min };
    if (max != null) return { ageMin: max, ageMax: max };
  }

  const min = toInt(ageMinInput);
  const max = toInt(ageMaxInput);

  if (min != null && max != null) {
    return { ageMin: Math.min(min, max), ageMax: Math.max(min, max) };
  }
  if (min != null) return { ageMin: min, ageMax: min };
  if (max != null) return { ageMin: max, ageMax: max };

  return { ageMin: null, ageMax: null };
}

/**
 * Maps known product types to their broader catalog category.
 */
export function getCategoryFromType(type: string | null): string | null {
  if (!type) return null;
  const t = type.toLowerCase();
  if (t === 'shirt' || t === 'top') return 'topwear';
  if (t === 'shorts' || t === 'jeans' || t === 'skirt' || t === 'dress') return 'bottomwear';
  return null;
}

/**
 * Deterministically checks for explicit catalog garment types mentioned in user input.
 */
export function detectProductType(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const t of KNOWN_TYPES) {
    const regex = new RegExp(`\\b${t}s?\\b`, 'i');
    if (regex.test(lower)) {
      return t;
    }
  }
  return null;
}

/**
 * Detects phrases where the customer explicitly indicates an attribute
 * is not important / does not matter (e.g. "any color", "price doesn't matter").
 */
export function detectUnimportantFields(text: string): ShoppingField[] {
  const patterns: [ShoppingField, RegExp][] = [
    ['color', /any color|color (?:doesn't|does not) matter|no color preference|don'?t care about (?:the )?color/i],
    ['occasion', /any occasion|occasion (?:doesn't|does not) matter|no specific occasion|don't care about (?:the )?occasion/i],
    ['maxPrice', /no budget|any price|price (?:doesn't|does not) matter|no price limit|don't care about (?:the )?price/i],
    ['gender', /unisex|any gender|boy or girl|gender (?:doesn't|does not) matter|don't care about gender/i],
    ['fit', /any fit|fit (?:doesn't|does not) matter|don't care about fit/i],
  ];
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([field]) => field);
}

/**
 * Returns the status of a specific shopping field:
 * - 'unimportant': Customer explicitly stated they don't care.
 * - 'known': A valid value has been captured.
 * - 'unknown': No information has been provided yet.
 */
export function getFieldStatus(state: ShoppingState, field: ShoppingField): FieldStatus {
  if (state.unimportantFields.includes(field)) {
    return 'unimportant';
  }
  const known = field === 'age'
    ? state.ageMin !== null || state.ageMax !== null
    : state[field] !== null;
  return known ? 'known' : 'unknown';
}

/**
 * Calculates which core shopping information is still missing from the conversation.
 */
export function calculateMissingFields(state: ShoppingState): ShoppingField[] {
  const missing: ShoppingField[] = [];

  const typeStatus = getFieldStatus(state, 'type');
  const categoryStatus = getFieldStatus(state, 'category');
  if (typeStatus === 'unknown' && categoryStatus === 'unknown') {
    missing.push('type');
  }

  if (getFieldStatus(state, 'gender') === 'unknown') {
    missing.push('gender');
  }

  if (getFieldStatus(state, 'age') === 'unknown') {
    missing.push('age');
  }

  return missing;
}

/** Search readiness is derived from the same rule used to choose clarifying questions. */
export function canSearch(state: ShoppingState): boolean {
  return calculateMissingFields(state).length === 0;
}

const VALID_FIELDS: ShoppingField[] = ['category', 'type', 'gender', 'age', 'occasion', 'color', 'maxPrice', 'fit'];
function normalizeUnimportantFields(value: unknown): ShoppingField[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((field): field is ShoppingField => VALID_FIELDS.includes(field)))]
    : [];
}

/**
 * Merges newly extracted information into the existing shopping state.
 *
 * Rules:
 * 1. New explicit user information updates existing values (e.g. girls -> boys).
 * 2. Unmentioned fields in the latest turn (null / undefined) do NOT erase previous values.
 * 3. User corrections always take precedence.
 * 4. Explicitly provided values remove the field from `unimportantFields` if previously marked unimportant.
 * 5. Values are normalized (numeric price, age ranges, trimmed strings).
 */
export function mergeShoppingState(
  currentState: ShoppingState,
  update: ShoppingStateUpdate | Filters
): ShoppingState {
  const next: ShoppingState = {
    ...currentState,
    unimportantFields: [...currentState.unimportantFields],
  };

  // Update intent if explicitly provided
  if ('intent' in update && ['product', 'policy', 'general', 'sizing'].includes(update.intent)) {
    next.intent = update.intent;
  }

  // Handle explicitly marked unimportant fields
  if ('unimportantFields' in update && Array.isArray(update.unimportantFields)) {
    for (const f of normalizeUnimportantFields(update.unimportantFields)) {
      if (!next.unimportantFields.includes(f)) {
        next.unimportantFields.push(f);
      }
    }
  }

  // Helper to apply string fields with un-marking unimportant
  const applyStringField = (
    field: ShoppingField,
    key: keyof Pick<ShoppingState, 'category' | 'type' | 'gender' | 'occasion' | 'color' | 'fit'>,
    incomingVal: unknown
  ) => {
    if (incomingVal !== undefined && incomingVal !== null) {
      const normalized = normalizeString(incomingVal);
      if (normalized !== null) {
        next[key] = normalized;
        next.unimportantFields = next.unimportantFields.filter((f) => f !== field);
      }
    }
  };

  applyStringField('category', 'category', update.category);
  applyStringField('type', 'type', update.type);
  applyStringField('gender', 'gender', update.gender);
  applyStringField('occasion', 'occasion', update.occasion);
  applyStringField('color', 'color', update.color);
  applyStringField('fit', 'fit', 'fit' in update ? update.fit : undefined);

  // Normalize and apply price
  if (update.maxPrice !== undefined && update.maxPrice !== null) {
    const normalizedPrice = normalizePrice(update.maxPrice);
    if (normalizedPrice !== null) {
      next.maxPrice = normalizedPrice;
      next.unimportantFields = next.unimportantFields.filter((f) => f !== 'maxPrice');
    }
  }

  // Normalize and apply age
  const hasAgeInput =
    ('age' in update && update.age !== undefined && update.age !== null) ||
    (update.ageMin !== undefined && update.ageMin !== null) ||
    (update.ageMax !== undefined && update.ageMax !== null);

  if (hasAgeInput) {
    const ageVal = 'age' in update ? update.age : undefined;
    const normalizedAge = normalizeAge(ageVal, update.ageMin, update.ageMax);
    if (normalizedAge.ageMin !== null || normalizedAge.ageMax !== null) {
      next.ageMin = normalizedAge.ageMin;
      next.ageMax = normalizedAge.ageMax;
      next.unimportantFields = next.unimportantFields.filter((f) => f !== 'age');
    }
  }

  // Re-calculate derived metadata
  next.missingFields = calculateMissingFields(next);
  next.isReadyForSearch = next.missingFields.length === 0;

  return next;
}

/**
 * Converts the ongoing conversation ShoppingState into the search Filters object
 * expected by the product retrieval layer.
 *
 * Attributes explicitly marked as unimportant are sent as null so that the search
 * query remains unconstrained for those attributes.
 */
export function toSearchFilters(state: ShoppingState): Filters {
  return {
    category: state.unimportantFields.includes('category')
      ? null
      : (state.category ?? getCategoryFromType(state.type)),
    type: state.unimportantFields.includes('type') ? null : state.type,
    gender: state.unimportantFields.includes('gender') ? null : state.gender,
    maxPrice: state.unimportantFields.includes('maxPrice') ? null : state.maxPrice,
    ageMin: state.unimportantFields.includes('age') ? null : state.ageMin,
    ageMax: state.unimportantFields.includes('age') ? null : state.ageMax,
    occasion: state.unimportantFields.includes('occasion') ? null : state.occasion,
    color: state.unimportantFields.includes('color') ? null : state.color,
  };
}

/**
 * Validates and normalizes incoming ShoppingState received from the client.
 * Shields the server against malformed, tampered, or arbitrary client state.
 * Recomputes derived properties (missingFields, isReadyForSearch) deterministically.
 */
export function validateAndNormalizeShoppingState(incoming: unknown): ShoppingState {
  const initial = createInitialShoppingState();
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return initial;
  const raw = incoming as ShoppingStateUpdate;
  // mergeShoppingState is the single normalization boundary. Derived client values are ignored.
  const clean = mergeShoppingState(initial, { ...raw, unimportantFields: [] });
  clean.unimportantFields = normalizeUnimportantFields(raw.unimportantFields);
  clean.missingFields = calculateMissingFields(clean);
  clean.isReadyForSearch = clean.missingFields.length === 0;
  return clean;
}
