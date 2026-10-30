import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAssistant } from '../lib/assistant/engine';
import type { AssistantDependencies } from '../lib/assistant/contracts';
import { bkCatalog } from '../lib/catalog/bkCatalog';
import { classifyIntent } from '../lib/chat/intent';
import { decideProductConversation } from '../lib/chat/conversationDecision';
import { createInitialShoppingState, mergeShoppingState, toSearchFilters } from '../lib/chat/conversationState';
import type { ChatResponse, Filters, ShoppingState } from '../lib/chat/types';
import { toApiParams } from '../lib/search/bkApiParams';
import { toFacetCounts, toRayProduct, violatesFilters, type BkCard } from '../lib/search/bkLiveSearch';

/**
 * Ray on the live catalog, end to end through the real engine, decision, intent routing, word
 * mapping and chip funnel. Gemini is a scripted fake and the API is an in-memory search over the
 * recorded fixture cards (same filter rules as the live fallback guard). No network.
 */
type Index = { name: string; ok: boolean }[];
const index: Index = JSON.parse(readFileSync('fixtures/bk/index.json', 'utf8'));
const cards = new Map<string, BkCard>();
for (const entry of index.filter(e => e.ok && !e.name.includes('facets'))) {
  for (const card of JSON.parse(readFileSync(`fixtures/bk/${entry.name}.json`, 'utf8')).groups ?? []) cards.set(card.id, card);
}
const list = (value?: string | null) => (value ?? '').split(',').filter(Boolean);

/** In-memory stand-in for the live API: every filter the API applies, over all recorded cards. */
function memorySearch(filters: Filters): BkCard[] {
  const categories = list(filters.category);
  const age = Object.fromEntries(toApiParams(filters));
  return [...cards.values()].filter(card =>
    (categories.length ? categories : [null]).some(category => !violatesFilters(card, filters, category))
    && (!filters.searchText || card.name.toLowerCase().includes(filters.searchText))
    // Approximate the API's age overlap with the card's age fields (the API itself uses sizes).
    && (!age.ageMonthsMin || (card.ageMonthsMin != null && card.ageMonthsMax != null && card.ageMonthsMax >= Number(age.ageMonthsMin) && card.ageMonthsMin <= Number(age.ageMonthsMax))));
}

/** Gemini stand-in: the extraction it would return for each message. */
function geminiSays(extractions: Record<string, object | null>) {
  const prompts: string[] = [];
  return {
    prompts,
    generateContent: async (prompt: string) => {
      prompts.push(prompt);
      const message = JSON.parse(prompt.match(/Latest message: (".*")/)![1]);
      const extracted = extractions[message];
      if (extracted === undefined) throw new Error('no scripted extraction for ' + message);
      return { response: { text: () => JSON.stringify({ extracted, question: 'Model question?', suggestions: ['Under ₹500'] }) } };
    },
  };
}

const PRICE_LABEL = /₹|price|budget|under/i;

async function main() {
  const model = geminiSays({
    'shirt for my 5 year old son': { item: 'shirt', gender: 'boys', age: 5 },
    'frock for 2 year old girl': { item: 'frock', gender: 'girls', age: 2 },
    'ethnic wear for diwali, boy, 6': { item: 'ethnic wear', gender: 'boys', age: 6 },
    'party dress for my daughter, 4': { item: 'party dress', gender: 'girls', age: 4 },
    'under 800': { item: null, maxPrice: 800 },
    'toys': { item: 'toys' },
    '3': { age: 3 },
    'orange t-shirt': { item: 't-shirt', color: 'orange' },
    'gift for my 4 year old': { item: null, age: 4 },
    'stroller': { item: 'stroller' },
    'bib for my baby': { item: 'bib' },
    '1': { age: 1 },
    'wooden toy for 1 year old': { item: 'wooden toy', age: 1 },
    'laptop': { item: 'laptop' },
    'hoverboard for my son, 8': { item: 'hoverboard', gender: 'boys', age: 8 },
    'pink frock under 300 for my 3 year old girl': { item: 'frock', color: 'pink', gender: 'girls', age: 3, maxPrice: 300 },
    'dresses for girls': { item: 'dresses', gender: 'girls' },
    'show dresses for diwali': { item: 'dresses' },
    'For a boy 👦': { gender: 'boys' },
    'For a girl 👧': { gender: 'girls' },
    '4-5 years': { ageMin: 4, ageMax: 5 },
    '5': { age: 5 },
    'frok for my 3 year old girl': { item: 'frok', catalogMatch: 'clothing:frocks', gender: 'girls', age: 3 },
    'a jumper for my son, 7': { item: 'jumper', catalogMatch: 'clothing:jackets', gender: 'boys', age: 7 },
    'spaceship for my son, 7': { item: 'spaceship', catalogMatch: 'toys:spaceships', gender: 'boys', age: 7 },
    'shirt for my son, 7': { item: 'shirt', catalogMatch: 'toys:balls', gender: 'boys', age: 7 },
  });
  const searches: Filters[] = [];
  const replies: string[] = [];
  const dependencies: AssistantDependencies = {
    catalog: bkCatalog,
    classifyIntent: (message, history, state) => classifyIntent(model, message, history, state, bkCatalog.isProductMessage),
    generateGeneralReply: async () => 'Hello',
    handleSizingFlow: async () => ({ action: 'ask', reply: 'How tall?' }),
    generatePolicyResponse: async () => ({ reply: 'Policy', suggestions: [] }),
    decideProductConversation: (message, history, state) => decideProductConversation(model, message, history, state, bkCatalog),
    generateReply: async (_message, _history, _context, refinement) => { replies.push(String(refinement.nextRefinement)); return { reply: 'Here you go' }; },
    searchProducts: async (filters, _query, skip = 0, take = 24) => {
      searches.push(filters);
      return memorySearch(filters).slice(skip, skip + take).filter(card => (card.totalStock ?? 1) > 0).map(toRayProduct);
    },
    searchPolicyChunks: async () => [],
  };
  const ray = createAssistant(dependencies);
  const responses: ChatResponse[] = [];
  let state: ShoppingState | undefined;
  const say = async (message: string, extra: object = {}) => {
    const response = await ray.chat({ message, shoppingState: state, ...extra });
    responses.push(response);
    state = response.shoppingState;
    return response;
  };
  const fresh = () => { state = undefined; searches.length = 0; };

  // "shirt for my 5 year old son": Tier 1, everything known → one search with the right params.
  fresh();
  const shirt = await say('shirt for my 5 year old son');
  assert.equal(shirt.action, 'search');
  assert.deepEqual(Object.fromEntries(toApiParams(searches[0])), {
    verticalSlug: 'clothing', categorySlug: 'topwear', genders: 'BOYS,UNISEX', productTypes: 'shirts',
    ageMonthsMin: '60', ageMonthsMax: '60', sort: 'newest', limit: '24', page: '1',
  });
  assert.ok(shirt.products.every(p => p.gender === 'boys' || p.gender === 'unisex'));
  assert.ok(model.prompts.at(-1)!.includes('Toys & Games'), 'extraction prompt describes the live store');

  // "frock for 2 year old girl" → dresses / frocks.
  fresh();
  await say('frock for 2 year old girl');
  assert.deepEqual([searches[0].category, searches[0].type, searches[0].gender, searches[0].ageMin], ['dresses', 'frocks', 'girls', 2]);

  // "ethnic wear for diwali, boy, 6" → both ethnic categories; category chips narrow to one.
  fresh();
  const ethnic = await say('ethnic wear for diwali, boy, 6');
  assert.equal(searches[0].category, 'ethnic-wear', 'the empty Ethnic & Festive category is skipped');
  // Category chips narrow to one category only when the results really span both.
  const ethnicCategories = new Set(memorySearch(searches[0]).slice(0, 24).map(card => card.category?.slug));
  assert.equal(ethnic.nextRefinement === 'category', ethnicCategories.size >= 2, String(ethnic.nextRefinement));

  // "party dress for my daughter, 4" → party-wear.
  fresh();
  await say('party dress for my daughter, 4');
  assert.deepEqual([searches[0].category, searches[0].gender], ['party-wear', 'girls']);

  // "under 800" never relaxes: asks what, then keeps the budget through the search.
  fresh();
  const budget = await say('under 800');
  assert.equal(budget.action, 'ask');
  assert.match(budget.reply, /What are you shopping for/);
  assert.equal(budget.reply.includes('Model question'), false, 'live catalog asks its own questions');
  // Department chips come from the store hierarchy (most stock first) and refine directly.
  assert.equal(budget.suggestions[0].label, 'Apparel 👕');
  assert.ok(budget.suggestions.length <= 8 && budget.suggestions.every(s => s.refine?.vertical));
  assert.ok(budget.suggestions.some(s => s.refine?.vertical === 'toys'));
  const toys = await say('toys');
  assert.equal(toys.action, 'ask');
  assert.match(toys.reply, /Which kind of toys/, 'department → kind of toy');
  assert.ok(toys.suggestions.length >= 2 && toys.suggestions.every(s => s.refine?.category));
  const kind = toys.suggestions[0];
  const toyAge = await say(kind.label, { refine: kind.refine });
  assert.match(toyAge.reply, /How old/, 'toys need an age, never a gender');
  assert.equal(searches.length, 0, 'questions never search');
  const toysFound = await say('3');
  assert.equal(toysFound.action, 'search');
  assert.deepEqual([searches[0].vertical, searches[0].category, searches[0].maxPrice, searches[0].gender], ['toys', kind.refine!.category, 800, null]);
  assert.equal(toApiParams(searches[0]).get('priceMax'), '800');
  assert.ok(toysFound.products.every(p => p.price <= 800));

  // "orange t-shirt" → mango-orange; clothing still needs gender and age.
  fresh();
  const orange = await say('orange t-shirt');
  assert.equal(orange.action, 'ask');
  assert.equal(orange.shoppingState.color, 'mango-orange');
  assert.equal(orange.shoppingState.type, 't-shirts');

  // "gift for my 4 year old" → stage 0: search the store by age, offer department chips (max 6, by count).
  fresh();
  const gift = await say('gift for my 4 year old');
  assert.equal(gift.action, 'search');
  assert.equal(gift.nextRefinement, 'vertical');
  assert.ok(gift.suggestions.length >= 2 && gift.suggestions.length <= 6);
  assert.ok(gift.suggestions.every(s => s.refine?.vertical && !s.label.includes('-')), 'labels are names, not slugs');
  // A department chip leads through the remaining questions (kind, then boy/girl if needed) to products; age 4 is kept.
  const giftChip = gift.suggestions[0];
  let giftTurn = await say(giftChip.label, { refine: giftChip.refine });
  const asked: string[] = [];
  for (let step = 0; giftTurn.action === 'ask' && step < 3; step++) {
    asked.push(giftTurn.reply);
    const answer = giftTurn.suggestions[0];
    giftTurn = await say(answer.label, answer.refine ? { refine: answer.refine } : {});
  }
  assert.ok(/Which kind of/.test(asked[0] ?? ''), asked.join(' / '));
  assert.ok(!asked.some(question => /How old/.test(question)), 'age 4 is never asked again');
  assert.equal(giftTurn.action, 'search');
  assert.deepEqual([searches.at(-1)!.vertical, searches.at(-1)!.ageMin], [giftChip.refine!.vertical, 4]);

  // "stroller" → Tier 2 with no age data: no gender or age question, straight to products.
  fresh();
  const stroller = await say('stroller');
  assert.equal(stroller.action, 'search');
  assert.deepEqual(Object.fromEntries(toApiParams(searches[0])), { verticalSlug: 'travel-gear', productTypes: 'strollers', sort: 'newest', limit: '24', page: '1' });

  // "bib for my baby" → overlap across departments: asks age (no gender), then searches both categories.
  fresh();
  const bib = await say('bib for my baby');
  assert.equal(bib.action, 'ask');
  assert.deepEqual(bib.shoppingState.missingFields, ['age']);
  await say('1');
  assert.deepEqual([searches[0].category, searches[0].vertical], ['towels-bibs,feeding-bibs', null]);

  // "wooden toy for 1 year old" → toys + wood materials; asks which kind, keeping the wood.
  fresh();
  const wooden = await say('wooden toy for 1 year old');
  assert.match(wooden.reply, /Which kind of toys/);
  await say(wooden.suggestions[0].label, { refine: wooden.suggestions[0].refine });
  assert.equal(searches[0].vertical, 'toys');
  assert.ok(list(searches[0].material).includes('wood'));

  // Item the site doesn't sell → search text; zero matches → honest reply, no chips that change the item.
  fresh();
  const hoverboard = await say('hoverboard for my son, 8');
  assert.equal(searches.length, 1, 'searched exactly once: no loosening');
  assert.equal(searches[0].searchText, 'hoverboard');
  assert.deepEqual(hoverboard.products, []);
  assert.match(hoverboard.reply, /I couldn't find "hoverboard" for boys for age 8 right now\./);
  assert.deepEqual(hoverboard.suggestions, []);

  // Zero matches with optional filters: only remove chips for them, budget/gender/age untouched.
  fresh();
  const strict = await say('pink frock under 300 for my 3 year old girl');
  assert.equal(searches.length, 1);
  assert.deepEqual(strict.products, []);
  assert.match(strict.reply, /couldn't find pink frocks for girls under ₹300 for age 3/);
  assert.deepEqual(strict.suggestions, [{ label: 'Any color', remove: ['color'] }]);
  const loosened = await say('Any color', { remove: ['color'] });
  assert.deepEqual([searches[1].color, searches[1].maxPrice, searches[1].gender, searches[1].ageMin, searches[1].type], [null, 300, 'girls', 3, 'frocks']);
  assert.ok(loosened.products.every(p => p.price <= 300));

  // "Dress" means clothes: festival words pick festive clothes, never girls' Dresses for a boy.
  fresh();
  await say('show dresses for diwali');
  await say('For a boy 👦');
  const diwali = await say('4-5 years');
  assert.deepEqual([searches[0].vertical, searches[0].category, searches[0].gender], ['clothing', 'ethnic-wear', 'boys']);
  assert.doesNotMatch(diwali.reply, /dresses/i, 'never "dresses for boys"');

  // "dresses for girls" = girls' clothes → asks which kind (Dresses one tap away), then age, then results.
  fresh();
  const kinds = await say('dresses for girls');
  assert.equal(kinds.action, 'ask');
  assert.match(kinds.reply, /Which kind of clothes/);
  const dressChip = kinds.suggestions.find(chip => chip.refine?.category === 'dresses')!;
  assert.ok(dressChip, 'Dresses is one tap away');
  assert.ok(!kinds.suggestions.some(chip => chip.refine?.category === 'ethnic'), 'kinds with nothing in stock are not offered');
  const dressAge = await say(dressChip.label, { refine: dressChip.refine });
  assert.match(dressAge.reply, /How old/);
  const dresses = await say('5');
  assert.equal(dresses.action, 'search');
  assert.deepEqual([searches[0].vertical, searches[0].category, searches[0].gender], ['clothing', 'dresses', 'girls']);
  // Guarantee: every chip, applied, still matches at least one product (same filters, no extra calls).
  for (const chip of dresses.suggestions) {
    const refined = toSearchFilters(mergeShoppingState(dresses.shoppingState, chip.refine!));
    assert.ok(memorySearch(refined).length >= 1, 'chip leads to products: ' + chip.label);
  }
  const chipped = await say(dresses.suggestions[0].label, { refine: dresses.suggestions[0].refine });
  assert.ok(chipped.products.length >= 1);
  assert.notEqual(chipped.nextRefinement, dresses.nextRefinement, 'the funnel moves to the next dimension');

  // Small sets (8 or fewer matches): products only, no narrowing chips.
  const small = bkCatalog.buildChips(dresses.shoppingState, dresses.products.slice(0, 5), { complete: true });
  assert.deepEqual(small, { chips: [], nextRefinement: null });
  const large = memorySearch(toSearchFilters(dresses.shoppingState)).map(toRayProduct);
  assert.ok(large.length > 8);
  assert.equal(bkCatalog.buildChips(dresses.shoppingState, large, { complete: false }).nextRefinement, dresses.nextRefinement, 'larger sets do get chips');

  // Intent routing knows the live catalog's words without a model call.
  const before = model.prompts.length;
  assert.equal(await classifyIntent(model, 'potty seat', [], undefined, bkCatalog.isProductMessage), 'product');
  assert.equal(model.prompts.length, before);
  assert.equal(await classifyIntent(model, 'can I return the stroller?', [], undefined, bkCatalog.isProductMessage), 'policy');

  // No price chips anywhere, and chip labels are display names.
  for (const response of responses) for (const suggestion of response.suggestions) assert.doesNotMatch(suggestion.label, PRICE_LABEL, suggestion.label);

  // Gemini's closest real product type covers misspellings and synonyms the word map lacks.
  assert.match(model.prompts[0], /clothing: [^\n]*frocks/, 'the prompt lists the real product types');
  fresh();
  await say('frok for my 3 year old girl');
  assert.deepEqual([searches[0].vertical, searches[0].type, searches[0].searchText, searches[0].gender], ['clothing', 'frocks', null, 'girls']);
  fresh();
  await say('a jumper for my son, 7');
  assert.deepEqual([searches[0].vertical, searches[0].type], ['clothing', 'jackets']);
  fresh();
  await say('spaceship for my son, 7');
  assert.deepEqual([searches[0].type, searches[0].searchText], [null, 'spaceship'], 'an invented pair is ignored: plain text search');
  fresh();
  await say('shirt for my son, 7');
  assert.deepEqual([searches[0].type, searches[0].category], ['shirts', 'topwear'], 'the word map wins over the model');

  // Footwear and school supplies never ask boy/girl, but a gender the customer gives still filters.
  const shoes = mergeShoppingState(createInitialShoppingState(), { vertical: 'footwear' });
  assert.deepEqual(bkCatalog.missingFields(shoes), ['category', 'age'], 'which kind of footwear, then age: never boy/girl');
  assert.deepEqual(bkCatalog.missingFields(mergeShoppingState(createInitialShoppingState(), { vertical: 'school-supplies', type: 'school-backpacks' })), ['age']);
  assert.equal(toApiParams(toSearchFilters(mergeShoppingState(shoes, { gender: 'boys', ageMin: 6, ageMax: 6 }))).get('genders'), 'BOYS,UNISEX');

  // Facet chips: product type and clothing attributes come from the store's filter counts.
  const dressCounts = toFacetCounts(JSON.parse(readFileSync('fixtures/bk/facets-clothing-dresses.json', 'utf8')));
  const girlDresses = mergeShoppingState(createInitialShoppingState(), { vertical: 'clothing', category: 'dresses', gender: 'girls', ageMin: 5, ageMax: 5 });
  const dressSample = memorySearch(toSearchFilters(girlDresses)).map(toRayProduct);
  const byType = bkCatalog.buildChips(girlDresses, dressSample, { complete: false, facets: dressCounts });
  assert.equal(byType.nextRefinement, 'type', 'product type comes right after the category');
  assert.deepEqual(byType.chips.map(c => c.label), ['Frocks', 'Casual Dresses', 'Gowns']);
  assert.deepEqual(byType.chips[0].refine, { type: 'frocks' });
  const frocks = mergeShoppingState(girlDresses, { type: 'frocks' });
  assert.equal(bkCatalog.buildChips(frocks, dressSample, { complete: false, facets: dressCounts }).nextRefinement, 'color', 'colour (from cards) comes before attributes');
  const pinkFrocks = mergeShoppingState(frocks, { color: 'pink' });
  const occasions = bkCatalog.buildChips(pinkFrocks, dressSample, { complete: false, facets: dressCounts });
  assert.equal(occasions.nextRefinement, 'occasion');
  assert.deepEqual(occasions.chips.map(c => c.label), ['Casual', 'Party', 'Vacation/Casual Wear']);
  const fits = bkCatalog.buildChips(mergeShoppingState(pinkFrocks, { occasion: 'Casual' }), dressSample, { complete: false, facets: dressCounts });
  assert.equal(fits.nextRefinement, 'fit');
  const regular = fits.chips.find(c => c.label === 'Regular fit');
  assert.ok(regular, fits.chips.map(c => c.label).join(' | '));
  assert.deepEqual(new Set(regular.refine!.fit!.split(',')), new Set(['REGULAR FIT', 'Regular']), 'near-duplicate spellings become one chip');
  assert.equal(mergeShoppingState(pinkFrocks, { occasion: 'Casual' }).occasion, 'Casual', 'attribute labels keep their case');
  assert.equal(toApiParams(toSearchFilters(mergeShoppingState(pinkFrocks, regular.refine!))).get('fit'), 'REGULAR FIT,Regular');
  assert.equal(bkCatalog.buildChips(pinkFrocks, dressSample, { complete: false, facets: null }).nextRefinement, 'material', 'without counts, attribute dimensions are skipped');
  assert.deepEqual(bkCatalog.removeChips(mergeShoppingState(pinkFrocks, { occasion: 'Casual' })).map(c => c.label), ['Any color', 'Any occasion']);
  assert.match(bkCatalog.describe(mergeShoppingState(pinkFrocks, { occasion: 'Casual' })), /^pink casual frocks for girls for age 5$/);

  // The engine fetches counts alongside each search (once, in parallel) and survives their failure.
  const facetCalls: Filters[] = [];
  const withFacets = createAssistant({ ...dependencies, searchFacets: async filters => { facetCalls.push(filters); return dressCounts; } });
  const typed = await withFacets.chat({ message: 'Dresses', refine: { category: 'dresses' }, shoppingState: girlDresses });
  assert.equal(facetCalls.length, 1);
  assert.deepEqual(facetCalls[0], toSearchFilters(typed.shoppingState), 'same filters as the products call');
  assert.equal(typed.nextRefinement, 'type');
  const noFacets = createAssistant({ ...dependencies, searchFacets: async () => { throw new Error('facets down'); } });
  const stillShown = await noFacets.chat({ message: 'Dresses', refine: { category: 'dresses' }, shoppingState: girlDresses });
  assert.ok(stillShown.products.length > 0);
  assert.notEqual(stillShown.nextRefinement, 'type');

  console.log('Live-catalog conversation checks passed (tiers, stage 0, overlaps, colours, materials, budget, zero results, funnel, facet chips, routing).');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
