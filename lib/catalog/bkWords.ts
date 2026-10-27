import {
  BK_COLOUR_WORDS, BK_DATA, BK_MATERIAL_WORDS, BK_NON_ITEM_WORDS, BK_WORDS, bkCategory,
  type BkTarget,
} from './bkConfig';

/** What a customer's words resolve to in the bachpankart catalog. Slugs only come from config or API data. */
export type BkResolution = {
  vertical: string | null;
  /** Up to two categories; overlapping words ("bib", "ethnic") give two, searched as separate calls. */
  categories: string[];
  productType: string | null;
  colors: string[];
  materials: string[];
  brands: string[];
  /** Item words that matched nothing (sent as the API's `q` search text). */
  leftover: string;
  /** True when some item word was recognised (a vertical, category or product type). */
  matchedItem: boolean;
};

const MAX_CATEGORIES = 2;
/** Brand names that are ordinary words, so they never trigger a brand filter. */
const AMBIGUOUS_BRANDS = new Set(['kiddie', 'adore']);
const NOT_ITEM_WORDS = new Set([
  ...BK_NON_ITEM_WORDS,
  'under', 'below', 'within', 'budget', 'rs', 'inr', 'rupees', 'price', 'cheap', 'around', 'about', 'between', 'to',
  'he', 'she', 'his', 'her', 'is', 'are', 'it', 'yr', 'yrs', 'mo', 'age', 'aged', 'any', 'color', 'colour', 'size',
  // Quantities, prices and ages are never item words ("two shirts", "one thousand rupees").
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'twenty', 'fifty', 'hundred', 'thousand', 'lakh', 'rupee', 'rupees', 'pair', 'pairs',
]);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** "t-shirt" also matches "t shirt" / "tshirt"; plurals are optional. */
function phrasePattern(phrase: string): RegExp {
  const tokens = phrase.toLowerCase().split(/[\s-]+/).filter(Boolean).map(escape);
  return new RegExp(`(?<![a-z0-9])${tokens.join('[\\s-]*')}(?:e?s)?(?![a-z0-9])`, 'g');
}

const ENTRY_PATTERNS = BK_WORDS.flatMap(entry => entry.phrases.map(phrase => ({ pattern: phrasePattern(phrase), target: entry.target, modifier: Boolean(entry.modifier) })));

function allVerticalData() {
  return Object.values(BK_DATA.verticals);
}

/** A colour/material slug belongs to word `w` when its first or last word is `w` (or `w` + a short suffix: gold → golden). */
function slugHasWord(slug: string, word: string, edgesOnly: boolean): boolean {
  const tokens = slug.split('-');
  if (edgesOnly && (tokens.includes('with') || tokens.includes('base'))) return false;
  const candidates = edgesOnly ? [tokens[0], tokens.at(-1)!] : tokens;
  return candidates.some(token => token === word || (token.startsWith(word) && token.length <= word.length + 2));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

type Span = { start: number; end: number };
const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

export function resolveBkText(text: string, context: { vertical?: string | null } = {}): BkResolution {
  const lower = ` ${text.toLowerCase().replace(/[“”"'’]/g, '').replace(/[^a-z0-9₹\s-]/g, ' ').replace(/\s+/g, ' ')} `;

  // Item phrases: longest match wins, inner words of an accepted phrase are ignored.
  const found: (Span & { target: BkTarget; modifier: boolean })[] = [];
  for (const { pattern, target, modifier } of ENTRY_PATTERNS) {
    for (const match of lower.matchAll(pattern)) found.push({ start: match.index!, end: match.index! + match[0].length, target, modifier });
  }
  found.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const matched: typeof found = [];
  for (const candidate of found) if (!matched.some(span => overlaps(span, candidate))) matched.push(candidate);
  matched.sort((a, b) => a.start - b.start);
  // Occasion words narrow general clothes ("dress for Diwali") but never override a specific item
  // ("return gifts for party"): with a specific item present they are dropped.
  const items = matched.filter(span => !span.modifier);
  const generalClothes = items.every(span => span.target.vertical === 'clothing' && !span.target.categories?.length && !span.target.productType);
  const accepted = generalClothes ? matched : items;

  const categoryTargets = accepted.filter(span => span.target.categories?.length);
  const categories = unique(categoryTargets.flatMap(span => span.target.categories!)).slice(0, MAX_CATEGORIES);
  const categoryVerticals = unique(categories.map(slug => bkCategory(slug)?.vertical).filter(Boolean) as string[]);
  const verticalTargets = unique(accepted.map(span => span.target.vertical).filter(Boolean) as string[]);
  const vertical = categories.length
    ? (categoryVerticals.length === 1 ? categoryVerticals[0] : null)
    : (verticalTargets.length === 1 ? verticalTargets[0] : null);
  const typed = accepted.filter(span => span.target.productType);
  const productType = typed.length === 1 && accepted.length === 1 ? typed[0].target.productType! : null;

  // Colours, materials and brands, limited to the resolved vertical's data when known.
  const scope = vertical ?? context.vertical ?? null;
  const pool = scope && BK_DATA.verticals[scope] ? [BK_DATA.verticals[scope]] : allVerticalData();
  // Every matched phrase is used up, including occasion words dropped next to a specific item.
  const consumed: Span[] = matched.map(({ start, end }) => ({ start, end }));
  const wordsIn = (dictionary: Record<string, string>) => {
    const hits: string[] = [];
    for (const [word, canonical] of Object.entries(dictionary)) {
      for (const match of lower.matchAll(new RegExp(`(?<![a-z0-9])${escape(word)}(?![a-z0-9])`, 'g'))) {
        const span = { start: match.index!, end: match.index! + word.length };
        if (matched.some(item => overlaps(item, span))) continue;
        consumed.push(span);
        hits.push(canonical);
      }
    }
    return unique(hits);
  };
  const colourWords = wordsIn(BK_COLOUR_WORDS);
  const materialWords = wordsIn(BK_MATERIAL_WORDS);
  const colors = unique(pool.flatMap(data => data.colors.map(color => color.slug)).filter(slug => colourWords.some(word => slugHasWord(slug, word, true))));
  const materials = unique(pool.flatMap(data => data.materials.map(material => material.slug)).filter(slug => materialWords.some(word => slugHasWord(slug, word, false))));

  const brands: string[] = [];
  for (const data of allVerticalData()) {
    for (const brand of data.brands) {
      const name = brand.name.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
      if (name.length < 4 || AMBIGUOUS_BRANDS.has(name)) continue;
      const match = new RegExp(`(?<![a-z0-9])${escape(name)}(?![a-z0-9])`).exec(lower);
      if (match) {
        consumed.push({ start: match.index, end: match.index + name.length });
        brands.push(brand.slug);
      }
    }
  }

  // Whatever is left that looks like an item word becomes search text.
  let rest = lower;
  for (const span of consumed) rest = rest.slice(0, span.start) + ' '.repeat(span.end - span.start) + rest.slice(span.end);
  const leftover = rest.split(/[\s-]+/).filter(word => /^[a-z]{3,}$/.test(word) && !NOT_ITEM_WORDS.has(word)).join(' ');

  return {
    vertical,
    categories,
    productType,
    colors,
    materials,
    brands: unique(brands),
    leftover,
    matchedItem: accepted.length > 0,
  };
}

/** True when the text names something the store sells (used to route a message to product search). */
export function mentionsBkItem(text: string): boolean {
  return resolveBkText(text).matchedItem;
}
