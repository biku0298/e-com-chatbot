import type { ShoppingField } from '../chat/types';
import { calculateMissingFields } from '../chat/conversationState';
import { buildFunnelChips, buildRemoveChips, describeFilters } from '../chat/funnel';
import type { Catalog } from './types';

function fallbackQuestion(field: ShoppingField) {
  if (field === 'type' || field === 'category') {
    return { question: 'What type of clothing are you looking for — like shirts, tops, dresses, or pants?', suggestions: ['Shirts 👕', 'Dresses 👗', 'Jeans & Pants 👖', 'Tops ✨'] };
  }
  if (field === 'gender') {
    return { question: 'Sounds great! Is this for a boy or a girl?', suggestions: ['For a boy 👦', 'For a girl 👧'] };
  }
  return { question: 'Got it! How old is the child, or what age group is this for?', suggestions: ['2-3 years', '4-5 years', '6-7 years', '8-10 years'] };
}

/** The local Postgres catalog of 1000 generated products (CATALOG_SOURCE=fake). Behaviour is unchanged. */
export const fakeCatalog: Catalog = {
  id: 'fake',
  promptCatalog: `Catalog: types shirt/top/shorts/jeans/skirt/dress; categories topwear/bottomwear; genders boys/girls; occasions casual/party/ethnic; fits regular/slim/relaxed.
Normalize son/boy/him/nephew to boys; daughter/girl/her/niece to girls. Diwali/festive/traditional/wedding means ethnic.
Extract age or ageMin/ageMax from age expressions, including "he's six" or "between 5 and 7". Prices and item quantities are not ages.
Extract maxPrice numerically ("under a thousand" means 1000), colors and fit when given. Mark explicitly irrelevant attributes in unimportantFields, e.g. "any color" means color is unimportant.`,
  promptSearchRule: 'Search requires garment type OR category, gender, and age, each known or explicitly unimportant. Budget/color/occasion/fit are optional.',
  extractionShape: '{"category":null,"type":null,"gender":null,"age":null,"ageMin":null,"ageMax":null,"occasion":null,"color":null,"maxPrice":null,"fit":null,"unimportantFields":[]}',
  missingFields: calculateMissingFields,
  fallbackQuestion,
  searchQuery: (state, message, isChip) => [state.color, state.occasion, state.type, state.category, isChip ? null : message].filter(Boolean).join(' '),
  buildChips: (state, sample) => buildFunnelChips(state, sample),
  removeChips: buildRemoveChips,
  describe: describeFilters,
};
