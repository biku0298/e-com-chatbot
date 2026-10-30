import { ATTRIBUTE_FIELDS, MAX_CHIPS, REMOVE_LABELS, type FunnelField } from '../config';
import type { FacetCounts, FacetOption, ProductSearchResult, ShoppingField, ShoppingState, Suggestion } from '../chat/types';
import { toSearchFilters } from '../chat/conversationState';
import {
  BK_COLOUR_WORDS, BK_DATA, BK_SMALL_SET, BK_TIERS, bkCategory, bkTier, bkVertical,
  verticalAsksGender, verticalFiltersGender, verticalNeedsAge, verticalUsesAge, type BkDimension,
} from './bkConfig';
import { getTaxonomy, taxonomyCategory, taxonomyProductType, taxonomyProductTypes, taxonomyVertical, type BkStockCounts } from './bkTaxonomy';
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

/** Stock that suits the child: boys'/girls' stock when gender is known and matters here, else all. */
function stockFor(counts: BkStockCounts, gender: string | null, vertical: string): number {
  const genderTagged = counts.inStockBoys > 0 || counts.inStockGirls > 0;
  if (!genderTagged || !verticalFiltersGender(vertical)) return counts.inStockCount;
  if (gender === 'boys') return counts.inStockBoys;
  if (gender === 'girls') return counts.inStockGirls;
  return counts.inStockCount;
}

/** Departments with something in stock, most stock first (ties keep the store's order). */
function stockedVerticals() {
  const stock = (vertical: { categories: { inStockCount: number }[] }) => vertical.categories.reduce((sum, category) => sum + category.inStockCount, 0);
  return getTaxonomy().verticals.filter(vertical => stock(vertical) > 0).sort((a, b) => stock(b) - stock(a));
}

/** A department's categories with stock for this child, most stock first (ties keep the store's order). */
function stockedCategories(vertical: string, gender: string | null) {
  return (taxonomyVertical(vertical)?.categories ?? [])
    .filter(category => stockFor(category, gender, vertical) > 0)
    .sort((a, b) => stockFor(b, gender, vertical) - stockFor(a, gender, vertical));
}

/** Department known, kind unknown, and there is a real choice of kinds: ask which kind first. */
function needsCategory(state: ShoppingState): boolean {
  return Boolean(state.vertical) && !state.category && !state.type && !state.searchText
    && !state.unimportantFields.includes('category')
    && stockedCategories(state.vertical!, state.gender).length >= 2;
}

/** Chip dimensions that product cards carry (product type and attributes are facets-only). */
const CARD_DIMENSIONS = ['vertical', 'category', 'color', 'material', 'brand'] as const;
type CardDimension = typeof CARD_DIMENSIONS[number];
const isCardDimension = (dimension: BkDimension): dimension is CardDimension => (CARD_DIMENSIONS as readonly string[]).includes(dimension);

/** Chip dimensions that come from the filter counts fetched with the products. */
const FACET_DIMENSIONS = ['type', ...ATTRIBUTE_FIELDS] as const;
type FacetDimension = typeof FACET_DIMENSIONS[number];
const isFacetDimension = (dimension: BkDimension): dimension is FacetDimension => (FACET_DIMENSIONS as readonly string[]).includes(dimension);

function isSet(state: ShoppingState, dimension: CardDimension | FacetDimension): boolean {
  if (state.unimportantFields.includes(dimension)) return true;
  // Several categories (an overlapping word) still need narrowing to one.
  return dimension === 'category' ? list(state.category).length === 1 : Boolean(state[dimension]);
}

type ChipOption = { refine: string; label: string; count: number };

/** Card dimensions: values from the products just returned (each chip matches a shown, in-stock card). */
function cardOptions(sample: ProductSearchResult[], dimension: CardDimension): ChipOption[] {
  const counts = new Map<string, ChipOption>();
  for (const product of sample) {
    const value = product.facets?.[dimension];
    if (!value) continue;
    const option = counts.get(value.slug) ?? { refine: value.slug, label: value.name, count: 0 };
    option.count++;
    counts.set(value.slug, option);
  }
  return [...counts.values()];
}

/**
 * Facet dimensions: values from the store's counts for the current filters. Near-duplicate
 * attribute spellings ("Full Sleeve" / "Full Sleeves", "Regular" / "REGULAR FIT") become one chip
 * that asks for any of them.
 */
function facetOptions(options: FacetOption[] | undefined, dimension: FacetDimension): ChipOption[] {
  const groups = new Map<string, { values: string[]; best: FacetOption; count: number }>();
  for (const option of options ?? []) {
    const key = dimension === 'type' ? option.value : option.name.toLowerCase().replace(/\bfit\b/g, '').replace(/[^a-z0-9]/g, '').replace(/s$/, '');
    const group = groups.get(key);
    if (!group) groups.set(key, { values: [option.value], best: option, count: option.count });
    else {
      group.values.push(option.value);
      group.count += option.count;
      if (option.count > group.best.count) group.best = option;
    }
  }
  return [...groups.values()].map(group => {
    // Prefer a normally-cased spelling for the label ("Regular" over "REGULAR FIT").
    const shouty = (name: string) => name === name.toUpperCase() && /[A-Z]/.test(name);
    const name = shouty(group.best.name) ? (options ?? []).find(option => group.values.includes(option.value) && !shouty(option.name))?.name ?? group.best.name : group.best.name;
    return {
      refine: group.values.join(','),
      label: dimension === 'fit' && !/fit/i.test(name) ? `${name} fit` : name,
      count: group.count,
    };
  });
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
  for (const vertical of getTaxonomy().verticals) {
    const type = taxonomyProductType(vertical.slug, slug);
    if (type) return type.name.toLowerCase();
  }
  return slug.replace(/-/g, ' ');
};

/** Every real "department:productType" pair with stock, for the model to pick the closest from. */
function productTypeList(): string {
  return getTaxonomy().verticals
    .map(vertical => [vertical.slug, taxonomyProductTypes(vertical.slug).filter(type => type.inStockCount > 0).map(type => type.slug)] as const)
    .filter(([, types]) => types.length)
    .map(([vertical, types]) => `${vertical}: ${types.join(', ')}`)
    .join('\n');
}

/** The model's closest pick, accepted only when that department really has that product type. */
function validCatalogMatch(value: unknown): { vertical: string; productType: string } | null {
  if (typeof value !== 'string') return null;
  const [vertical, productType] = value.split(':').map(part => part.trim().toLowerCase());
  return vertical && productType && taxonomyProductType(vertical, productType) ? { vertical, productType } : null;
}

/**
 * The bachpankart catalog. Pure: words, rules and chips only; the API itself is called by
 * lib/search/bkLiveSearch.ts.
 */
export const bkCatalog: Catalog = {
  // Built on each use, so it always reflects the latest synced hierarchy.
  get promptCatalog() {
    return `The store sells: ${getTaxonomy().verticals.filter(vertical => vertical.categories.some(category => category.inStockCount > 0)).map(vertical => vertical.name).join(', ')}.
Extract "item": the product words the customer wants, as they said them (e.g. "frock", "stroller", "wooden toy", "ethnic wear"), or null when they name no product (e.g. "a gift", "something for my son").
Normalize son/boy/him/nephew to boys; daughter/girl/her/niece to girls. Never guess gender.
Extract age or ageMin/ageMax in whole years from age expressions, including "he's six" or "between 5 and 7". Prices and item quantities are not ages.
Extract maxPrice numerically ("under a thousand" means 1000) and a colour word when given. Mark explicitly irrelevant attributes in unimportantFields, e.g. "any color" means color is unimportant.
When there is an item, set "catalogMatch" to the closest "department:productType" from this list (misspellings and synonyms included, e.g. "frok" means clothing:frocks), or null when nothing fits. Use only pairs from the list:
${productTypeList()}`;
  },
  promptSearchRule: 'Search requires knowing what the customer wants. Clothing also needs gender and age; most other departments need age; toys, books and baby products never need gender. Budget and colour are optional.',
  extractionShape: '{"item":null,"catalogMatch":null,"gender":null,"age":null,"ageMin":null,"ageMax":null,"color":null,"maxPrice":null,"unimportantFields":[]}',
  // Gemini does not know the per-department rules, so the questions are fixed.
  useModelQuestion: false,

  resolveItem(message, extracted, current) {
    const itemText = typeof extracted?.item === 'string' && extracted.item.trim() ? extracted.item : null;
    const colourText = typeof extracted?.color === 'string' ? extracted.color : '';
    const context = { vertical: current.vertical };
    const fromMessage = resolveBkText(message, context);
    const fromItem = itemText ? resolveBkText(`${itemText} ${colourText}`, context) : null;
    // The model's item words usually win, but the whole message can be more specific:
    // item "dresses" + message "dresses for Diwali" → festive clothes, not clothes in general.
    const specificity = (resolution: typeof fromMessage | null) =>
      !resolution?.matchedItem ? -1 : resolution.productType ? 2 : resolution.categories.length ? 1 : 0;
    const item = specificity(fromMessage) > specificity(fromItem) ? fromMessage : fromItem?.matchedItem ? fromItem : fromMessage.matchedItem ? fromMessage : fromItem;
    // The word map wins; otherwise the model's closest real product type (misspellings, synonyms).
    const closest = item?.matchedItem ? null : validCatalogMatch(extracted?.catalogMatch);
    // Words nothing matched become search text: from the model's item, or from the message when the model is unavailable.
    const leftover = closest ? '' : item?.leftover || (!item?.matchedItem && extracted === null ? fromMessage.leftover : '');
    const colors = [...new Set([...fromMessage.colors, ...(fromItem?.colors ?? [])])];
    const materials = [...new Set([...fromMessage.materials, ...(fromItem?.materials ?? [])])];
    const brands = [...new Set([...fromMessage.brands, ...(fromItem?.brands ?? [])])];

    const next = closest
      ? { vertical: closest.vertical, category: null, type: closest.productType, searchText: null }
      : {
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
    // The store's hierarchy, in order: department → kind (category) → then who it is for.
    if (needsCategory(state)) missing.push('category');
    const ageKnown = state.ageMin != null || state.ageMax != null || state.unimportantFields.includes('age');
    const genderKnown = Boolean(state.gender) || state.unimportantFields.includes('gender');
    if (!genderKnown && verticals.some(verticalAsksGender)) missing.push('gender');
    if (!ageKnown && verticals.some(verticalNeedsAge)) missing.push('age');
    return missing;
  },

  fallbackQuestion(field, state) {
    // Which kind: the department's categories with stock for this child (a tap refines directly).
    if (field === 'category' && state.vertical) {
      const vertical = bkVertical(state.vertical);
      return {
        question: `Lovely! Which kind of ${vertical?.noun ?? 'products'} are you looking for?`,
        suggestions: stockedCategories(state.vertical, state.gender)
          .map(category => ({ label: category.name, refine: { category: category.slug } })),
      };
    }
    // What: the store's departments with stock.
    if (field === 'type' || field === 'category' || field === 'vertical') {
      return {
        question: 'Happy to help! What are you shopping for today?',
        suggestions: stockedVerticals()
          .map(vertical => {
            const emoji = bkVertical(vertical.slug)?.emoji;
            return { label: emoji ? `${vertical.name} ${emoji}` : vertical.name, refine: { vertical: vertical.slug } };
          }),
      };
    }
    // Who: only offer a boy or a girl where the chosen kind has stock for them.
    if (field === 'gender') {
      const chosen = list(state.category).length === 1 ? taxonomyCategory(list(state.category)[0]) : undefined;
      const scope = chosen ? [chosen] : taxonomyVertical(state.vertical)?.categories ?? [];
      const boys = scope.reduce((sum, category) => sum + category.inStockBoys, 0);
      const girls = scope.reduce((sum, category) => sum + category.inStockGirls, 0);
      const either = boys === 0 && girls === 0;
      const suggestions = [
        ...(either || boys > 0 ? [{ label: 'For a boy 👦' }] : []),
        ...(either || girls > 0 ? [{ label: 'For a girl 👧' }] : []),
      ];
      return { question: 'Sounds great! Is this for a boy or a girl?', suggestions };
    }
    return { question: 'Got it! How old is the little one?', suggestions: ['0-1 years', '2-3 years', '4-5 years', '6-8 years'].map(label => ({ label })) };
  },

  isProductMessage: mentionsBkItem,

  /** Only used for logging and pagination; the live search reads its words from the filters. */
  searchQuery: (state, message) => [state.vertical, state.category, state.type, state.searchText].filter(Boolean).join(' ') || message,

  buildChips(state, sample, { complete, facets }) {
    const none = { chips: [] as Suggestion[], nextRefinement: null };
    // Few matches: just show them, no narrowing.
    if (complete && sample.length <= BK_SMALL_SET) return none;
    const verticals = itemVerticals(state);
    const funnel = BK_TIERS[verticals.length === 1 ? bkTier(verticals[0]) : 2].funnel;
    const order: BkDimension[] = [...(state.vertical || state.category ? [] : ['vertical' as const]), 'category', ...funnel];

    for (const dimension of [...new Set(order)]) {
      // Product type and attributes are not on product cards: they come from the filter counts.
      const options = isCardDimension(dimension) ? (isSet(state, dimension) ? [] : cardOptions(sample, dimension))
        : isFacetDimension(dimension) ? (isSet(state, dimension) ? [] : facetOptions((facets as FacetCounts | null | undefined)?.[dimension], dimension))
        : [];
      if (options.length < 2) continue;
      const max = dimension === 'vertical' ? Infinity : MAX_CHIPS;
      const chips = options
        .sort((a, b) => b.count - a.count)
        .slice(0, max)
        .map(option => ({ label: option.label, refine: { [dimension]: option.refine } }));
      return { chips, nextRefinement: dimension as FunnelField };
    }
    return none;
  },

  removeChips(state) {
    const filters = toSearchFilters(state);
    return (['color', ...ATTRIBUTE_FIELDS, 'material', 'brand'] as const)
      .filter(field => filters[field])
      .map(field => ({ label: REMOVE_LABELS[field]!, remove: [field] }));
  },

  describe(state) {
    const filters = toSearchFilters(state);
    const verticals = itemVerticals(state);
    const categories = list(filters.category).map(slug => bkCategory(slug)?.label.toLowerCase() ?? slug);
    const item = filters.type ? productTypeName(filters.type)
      : categories.length ? categories.join(' or ')
      : filters.vertical ? (bkVertical(filters.vertical)?.noun ?? filters.vertical)
      : filters.searchText ? `"${filters.searchText}"` : 'products';
    const usesGender = !verticals.length || verticals.some(verticalFiltersGender);
    const usesAge = !verticals.length || verticals.some(verticalUsesAge);
    const age = !usesAge || filters.ageMin == null ? null
      : filters.ageMax != null && filters.ageMax !== filters.ageMin ? `for ages ${filters.ageMin}–${filters.ageMax}` : `for age ${filters.ageMin}`;
    // Attribute labels read naturally before the item: "red casual full sleeve shirts".
    const attributes = ATTRIBUTE_FIELDS.map(field => list(filters[field])[0]?.toLowerCase()).filter(Boolean);
    return [
      list(filters.color).length ? colourName(list(filters.color)) : null,
      ...attributes,
      item,
      filters.searchText && filters.searchText !== item.replace(/"/g, '') && !item.startsWith('"') ? `matching "${filters.searchText}"` : null,
      usesGender && filters.gender ? `for ${filters.gender}` : null,
      filters.maxPrice != null ? `under ₹${filters.maxPrice}` : null,
      age,
    ].filter(Boolean).join(' ');
  },
};
