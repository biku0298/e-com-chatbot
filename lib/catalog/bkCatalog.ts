import { MAX_CHIPS, REMOVE_LABELS, type FunnelField } from '../config';
import type { ProductSearchResult, ShoppingField, ShoppingState, Suggestion } from '../chat/types';
import { toSearchFilters } from '../chat/conversationState';
import {
  BK_COLOUR_WORDS, BK_DATA, BK_MAX_VERTICAL_CHIPS, BK_SMALL_SET, BK_TIERS, BK_VERTICALS, bkCategory, bkTier, bkVertical,
  verticalNeedsAge, verticalNeedsGender, verticalUsesAge, type BkDimension,
} from './bkConfig';
import { mentionsBkItem, resolveBkText } from './bkWords';
import type { Catalog } from './types';

const list = (value: string | null | undefined) => (value ?? '').split(',').map(part => part.trim()).filter(Boolean);

/** Verticals the current item belongs to (one, or two for words that span departments, like "bib"). */
function itemVerticals(state: ShoppingState): string[] {
  if (state.vertical) return [state.vertical];
  return [...new Set(list(state.category).map(slug => bkCategory(slug)?.vertical).filter(Boolean) as string[])];
}

function itemKnown(state: ShoppingState): boolean {
  return Boolean(state.vertical || state.category || state.type || state.searchText);
}

/** Chip dimensions that product cards carry (product type and attributes are facets-only). */
const CARD_DIMENSIONS = ['vertical', 'category', 'color', 'material', 'brand'] as const;
type CardDimension = typeof CARD_DIMENSIONS[number];
const isCardDimension = (dimension: BkDimension): dimension is CardDimension => (CARD_DIMENSIONS as readonly string[]).includes(dimension);

function isSet(state: ShoppingState, dimension: CardDimension): boolean {
  if (state.unimportantFields.includes(dimension)) return true;
  // Several categories (an overlapping word) still need narrowing to one.
  return dimension === 'category' ? list(state.category).length === 1 : Boolean(state[dimension]);
}

/** One shade (a chip): its display name. Several shades (a colour word): the word they share, e.g. "pink". */
function colourName(slugs: string[]): string {
  if (slugs.length > 1) {
    const edges = (slug: string) => [slug.split('-')[0], slug.split('-').at(-1)!];
    const shared = [...new Set(Object.values(BK_COLOUR_WORDS))].find(word => slugs.every(slug => edges(slug).some(token => token.startsWith(word))));
    if (shared) return shared;
  }
  for (const data of Object.values(BK_DATA.verticals)) {
    const colour = data.colors.find(entry => entry.slug === slugs[0]);
    if (colour) return colour.name.toLowerCase();
  }
  return slugs[0].replace(/-/g, ' ');
}
const productTypeName = (slug: string) => {
  for (const data of Object.values(BK_DATA.verticals)) {
    const type = data.productTypes.find(entry => entry.slug === slug);
    if (type) return type.name.toLowerCase();
  }
  return slug.replace(/-/g, ' ');
};

/**
 * The bachpankart catalog. Pure: words, rules and chips only; the API itself is called by
 * lib/search/bkLiveSearch.ts.
 */
export const bkCatalog: Catalog = {
  promptCatalog: `The store sells: ${BK_VERTICALS.map(vertical => vertical.label).join(', ')}.
Extract "item": the product words the customer wants, as they said them (e.g. "frock", "stroller", "wooden toy", "ethnic wear"), or null when they name no product (e.g. "a gift", "something for my son").
Normalize son/boy/him/nephew to boys; daughter/girl/her/niece to girls. Never guess gender.
Extract age or ageMin/ageMax in whole years from age expressions, including "he's six" or "between 5 and 7". Prices and item quantities are not ages.
Extract maxPrice numerically ("under a thousand" means 1000) and a colour word when given. Mark explicitly irrelevant attributes in unimportantFields, e.g. "any color" means color is unimportant.`,
  promptSearchRule: 'Search requires knowing what the customer wants. Clothing also needs gender and age; most other departments need age; toys, books and baby products never need gender. Budget and colour are optional.',
  extractionShape: '{"item":null,"gender":null,"age":null,"ageMin":null,"ageMax":null,"color":null,"maxPrice":null,"unimportantFields":[]}',
  // Gemini does not know the per-department rules, so the questions are fixed.
  useModelQuestion: false,

  resolveItem(message, extracted, current) {
    const itemText = typeof extracted?.item === 'string' && extracted.item.trim() ? extracted.item : null;
    const colourText = typeof extracted?.color === 'string' ? extracted.color : '';
    const context = { vertical: current.vertical };
    const fromMessage = resolveBkText(message, context);
    const fromItem = itemText ? resolveBkText(`${itemText} ${colourText}`, context) : null;
    const item = fromItem?.matchedItem ? fromItem : fromMessage.matchedItem ? fromMessage : fromItem;
    // Unmapped item words become search text: from the model's item, or from the message when the model is unavailable.
    const leftover = item?.leftover || (!item?.matchedItem && extracted === null ? fromMessage.leftover : '');
    const colors = [...new Set([...fromMessage.colors, ...(fromItem?.colors ?? [])])];
    const materials = [...new Set([...fromMessage.materials, ...(fromItem?.materials ?? [])])];
    const brands = [...new Set([...fromMessage.brands, ...(fromItem?.brands ?? [])])];

    const next = {
      vertical: item?.matchedItem ? item.vertical : null,
      category: item?.matchedItem ? item.categories.join(',') || null : null,
      type: item?.matchedItem ? item.productType : null,
      searchText: leftover || null,
    };
    const namesItem = Boolean(next.vertical || next.category || next.type || next.searchText);
    const sameItem = next.vertical === current.vertical && next.category === current.category && next.type === current.type && next.searchText === current.searchText;
    return {
      update: {
        ...next,
        color: colors.join(',') || null,
        material: materials.join(',') || null,
        brand: brands.join(',') || null,
      },
      replacesItem: namesItem && !sameItem,
    };
  },

  missingFields(state) {
    if (!itemKnown(state) && !state.unimportantFields.includes('type')) {
      // Stage 0: with an age or gender we can already look across the whole store.
      return state.ageMin != null || state.ageMax != null || state.gender ? [] : ['type'];
    }
    const verticals = itemVerticals(state);
    const missing: ShoppingField[] = [];
    const ageKnown = state.ageMin != null || state.ageMax != null || state.unimportantFields.includes('age');
    const genderKnown = Boolean(state.gender) || state.unimportantFields.includes('gender');
    if (!genderKnown && verticals.some(verticalNeedsGender)) missing.push('gender');
    if (!ageKnown && verticals.some(verticalNeedsAge)) missing.push('age');
    return missing;
  },

  fallbackQuestion(field) {
    if (field === 'type' || field === 'category' || field === 'vertical') {
      return {
        question: 'Happy to help! What are you shopping for today?',
        suggestions: ['Clothes 👕', 'Toys 🧸', 'Books 📚', 'Baby care 🍼', 'Footwear 👟', 'School supplies 🎒'],
      };
    }
    if (field === 'gender') {
      return { question: 'Sounds great! Is this for a boy or a girl?', suggestions: ['For a boy 👦', 'For a girl 👧'] };
    }
    return { question: 'Got it! How old is the little one?', suggestions: ['0-1 years', '2-3 years', '4-5 years', '6-8 years'] };
  },

  isProductMessage: mentionsBkItem,

  /** Only used for logging and pagination; the live search reads its words from the filters. */
  searchQuery: (state, message) => [state.vertical, state.category, state.type, state.searchText].filter(Boolean).join(' ') || message,

  buildChips(state, sample, { complete }) {
    const none = { chips: [] as Suggestion[], nextRefinement: null };
    // Few matches: just show them, no narrowing.
    if (complete && sample.length <= BK_SMALL_SET) return none;
    const verticals = itemVerticals(state);
    const funnel = BK_TIERS[verticals.length === 1 ? bkTier(verticals[0]) : 2].funnel;
    const order: BkDimension[] = [...(state.vertical || state.category ? [] : ['vertical' as const]), 'category', ...funnel];

    for (const dimension of [...new Set(order)]) {
      // Product type and attributes are not on product cards, so they cannot be chips without extra calls.
      if (!isCardDimension(dimension) || isSet(state, dimension)) continue;
      const counts = new Map<string, { name: string; count: number }>();
      for (const product of sample as ProductSearchResult[]) {
        const value = product.facets?.[dimension];
        if (!value) continue;
        const entry = counts.get(value.slug) ?? { name: value.name, count: 0 };
        entry.count++;
        counts.set(value.slug, entry);
      }
      if (counts.size < 2) continue;
      const max = dimension === 'vertical' ? BK_MAX_VERTICAL_CHIPS : MAX_CHIPS;
      const chips = [...counts.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, max)
        .map(([slug, { name }]) => ({ label: name, refine: { [dimension]: slug } }));
      return { chips, nextRefinement: dimension as FunnelField };
    }
    return none;
  },

  removeChips(state) {
    const filters = toSearchFilters(state);
    return (['color', 'material', 'brand', 'occasion', 'fit'] as const)
      .filter(field => filters[field])
      .map(field => ({ label: REMOVE_LABELS[field]!, remove: [field] }));
  },

  describe(state) {
    const filters = toSearchFilters(state);
    const verticals = itemVerticals(state);
    const categories = list(filters.category).map(slug => bkCategory(slug)?.label.toLowerCase() ?? slug);
    const item = filters.type ? productTypeName(filters.type)
      : categories.length ? categories.join(' or ')
      : filters.vertical ? (bkVertical(filters.vertical)?.label.toLowerCase() ?? filters.vertical)
      : filters.searchText ? `"${filters.searchText}"` : 'products';
    const usesGender = !verticals.length || verticals.some(verticalNeedsGender);
    const usesAge = !verticals.length || verticals.some(verticalUsesAge);
    const age = !usesAge || filters.ageMin == null ? null
      : filters.ageMax != null && filters.ageMax !== filters.ageMin ? `for ages ${filters.ageMin}–${filters.ageMax}` : `for age ${filters.ageMin}`;
    return [
      list(filters.color).length ? colourName(list(filters.color)) : null,
      item,
      filters.searchText && filters.searchText !== item.replace(/"/g, '') && !item.startsWith('"') ? `matching "${filters.searchText}"` : null,
      usesGender && filters.gender ? `for ${filters.gender}` : null,
      filters.maxPrice != null ? `under ₹${filters.maxPrice}` : null,
      age,
    ].filter(Boolean).join(' ');
  },
};
