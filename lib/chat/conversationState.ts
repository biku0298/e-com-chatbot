import {
  Filters,
  FieldStatus,
  ShoppingField,
  ShoppingState,
  ShoppingStateUpdate,
} from './types';

export const KNOWN_CATEGORIES = ['topwear', 'bottomwear'] as const;
export const KNOWN_TYPES = ['shirt', 'top', 'shorts', 'jeans', 'skirt', 'dress'] as const;
export const KNOWN_GENDERS = ['boys', 'girls'] as const;
export const KNOWN_OCCASIONS = ['casual', 'party', 'ethnic'] as const;
export const KNOWN_COLORS = ['red', 'blue', 'green', 'yellow', 'black', 'white', 'pink', 'grey'] as const;
export const KNOWN_FITS = ['regular', 'slim', 'relaxed'] as const;

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
  if (value == null) return null;
  const str = String(value).trim().toLowerCase();
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
    return isNaN(value) || value <= 0 ? null : Math.round(value);
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
    if (val == null) return null;
    const n = typeof val === 'number' ? val : parseInt(String(val), 10);
    return isNaN(n) || n < 0 ? null : Math.round(n);
  };

  if (typeof ageInput === 'number' && !isNaN(ageInput)) {
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
  if (!text) return [];
  const lower = text.toLowerCase();
  const fields: ShoppingField[] = [];

  if (
    lower.includes('any color') ||
    lower.includes("color doesn't matter") ||
    lower.includes('color does not matter') ||
    lower.includes('no color preference') ||
    lower.includes("don't care about the color") ||
    lower.includes("don't care about color") ||
    lower.includes("dont care about the color") ||
    lower.includes("dont care about color")
  ) {
    fields.push('color');
  }

  if (
    lower.includes('any occasion') ||
    lower.includes("occasion doesn't matter") ||
    lower.includes('occasion does not matter') ||
    lower.includes('no specific occasion') ||
    lower.includes("don't care about the occasion") ||
    lower.includes("don't care about occasion")
  ) {
    fields.push('occasion');
  }

  if (
    lower.includes('no budget') ||
    lower.includes('any price') ||
    lower.includes("price doesn't matter") ||
    lower.includes('price does not matter') ||
    lower.includes('no price limit') ||
    lower.includes("don't care about the price") ||
    lower.includes("don't care about price")
  ) {
    fields.push('maxPrice');
  }

  if (
    lower.includes('unisex') ||
    lower.includes('any gender') ||
    lower.includes('boy or girl') ||
    lower.includes("gender doesn't matter") ||
    lower.includes('gender does not matter') ||
    lower.includes("don't care about gender")
  ) {
    fields.push('gender');
  }

  if (
    lower.includes('any fit') ||
    lower.includes("fit doesn't matter") ||
    lower.includes('fit does not matter') ||
    lower.includes("don't care about fit")
  ) {
    fields.push('fit');
  }

  return fields;
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
  switch (field) {
    case 'category':
      return state.category !== null ? 'known' : 'unknown';
    case 'type':
      return state.type !== null ? 'known' : 'unknown';
    case 'gender':
      return state.gender !== null ? 'known' : 'unknown';
    case 'age':
      return state.ageMin !== null || state.ageMax !== null ? 'known' : 'unknown';
    case 'occasion':
      return state.occasion !== null ? 'known' : 'unknown';
    case 'color':
      return state.color !== null ? 'known' : 'unknown';
    case 'maxPrice':
      return state.maxPrice !== null ? 'known' : 'unknown';
    case 'fit':
      return state.fit !== null ? 'known' : 'unknown';
    default:
      return 'unknown';
  }
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

/**
 * Deterministic server-side readiness validator.
 * Verifies that all mandatory shopping criteria are present (or explicitly marked unimportant)
 * before a product search is permitted:
 * 1. Product type or broad category
 * 2. Target gender (boys / girls)
 * 3. Child's age or usable age range
 *
 * Optional attributes (color, occasion, budget, fit) improve results but do not block search.
 */
export function canSearch(state: ShoppingState): boolean {
  const hasGarment =
    state.type !== null ||
    state.category !== null ||
    state.unimportantFields.includes('type') ||
    state.unimportantFields.includes('category');

  const hasGender =
    state.gender !== null ||
    state.unimportantFields.includes('gender');

  const hasAge =
    (state.ageMin !== null || state.ageMax !== null) ||
    state.unimportantFields.includes('age');

  return Boolean(hasGarment && hasGender && hasAge);
}

/**
 * Checks whether the current state has enough information to execute a focused search.
 */
export function isStateReadyForSearch(state: ShoppingState): boolean {
  return canSearch(state);
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
  if ('intent' in update && update.intent !== undefined && update.intent !== null) {
    next.intent = update.intent;
  }

  // Handle explicitly marked unimportant fields
  if ('unimportantFields' in update && Array.isArray(update.unimportantFields)) {
    for (const f of update.unimportantFields) {
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
  next.isReadyForSearch = isStateReadyForSearch(next);

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
  if (!incoming || typeof incoming !== 'object') {
    return createInitialShoppingState();
  }

  const raw = incoming as Partial<ShoppingState>;

  const cleanState: ShoppingState = {
    intent: raw.intent && ['product', 'policy', 'general', 'sizing'].includes(raw.intent)
      ? raw.intent
      : null,
    category: normalizeString(raw.category),
    type: normalizeString(raw.type),
    gender: normalizeString(raw.gender),
    occasion: normalizeString(raw.occasion),
    color: normalizeString(raw.color),
    fit: normalizeString(raw.fit),
    maxPrice: normalizePrice(raw.maxPrice),
    ageMin: null,
    ageMax: null,
    unimportantFields: [],
    missingFields: [],
    isReadyForSearch: false,
  };

  // Validate and normalize age
  const ageObj = normalizeAge(undefined, raw.ageMin, raw.ageMax);
  cleanState.ageMin = ageObj.ageMin;
  cleanState.ageMax = ageObj.ageMax;

  // Validate unimportantFields
  const validFields: ShoppingField[] = [
    'category',
    'type',
    'gender',
    'age',
    'occasion',
    'color',
    'maxPrice',
    'fit',
  ];
  if (Array.isArray(raw.unimportantFields)) {
    cleanState.unimportantFields = raw.unimportantFields.filter(
      (f): f is ShoppingField => typeof f === 'string' && validFields.includes(f as ShoppingField)
    );
  }

  // Recompute derived fields deterministically on the server
  cleanState.missingFields = calculateMissingFields(cleanState);
  cleanState.isReadyForSearch = canSearch(cleanState);

  return cleanState;
}

