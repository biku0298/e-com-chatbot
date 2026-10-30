import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CATALOG_UNAVAILABLE_REPLY, createAssistant } from '../lib/assistant/engine';
import { CatalogUnavailableError } from '../lib/catalog/errors';
import { bkCatalog } from '../lib/catalog/bkCatalog';
import { InputError, parseChatInput, parseMoreInput } from '../lib/assistant/input';
import { createQueryCache } from '../lib/ai/queryCache';
import { createInitialShoppingState, mergeShoppingState } from '../lib/chat/conversationState';
import type { AssistantDependencies } from '../lib/assistant/contracts';
import type { Filters, ProductSearchResult } from '../lib/chat/types';
import { CHIP_SAMPLE_SIZE, PAGE_SIZE } from '../lib/config';

/** Every module engine.ts loads at runtime (type-only imports are erased and skipped). */
function runtimeImports(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const match of readFileSync(file, 'utf8').matchAll(/^import\s+(?!type\b)[^'"]*from\s+'([^']+)'/gm)) {
    const target = match[1].startsWith('@/') ? match[1].slice(2) : match[1].startsWith('.') ? join(dirname(file), match[1]) : null;
    if (!target) continue;
    const resolved = ['.ts', '.tsx', '.json', '/index.ts'].map(ext => target + ext).find(existsSync);
    if (resolved && resolved.endsWith('.ts')) runtimeImports(resolved, seen);
  }
  return seen;
}

/** A product shaped like a live bachpankart card (girls' dresses). */
function item(id: number, color: string, brand = 'frockwala'): ProductSearchResult {
  return {
    id: `p${id}`, name: `${color} frock`, price: 450, imageUrl: '', color, size: '2-3y – 6-7y', gender: 'girls',
    type: 'dresses', category: 'dresses', brand,
    facets: {
      vertical: { slug: 'clothing', name: 'Apparel' },
      category: { slug: 'dresses', name: 'Dresses' },
      color: { slug: color, name: color[0].toUpperCase() + color.slice(1) },
      material: { slug: 'cotton', name: 'Cotton' },
      brand: { slug: brand, name: brand === 'frockwala' ? 'Frockwala' : 'Sonika' },
    },
  };
}

async function main() {
  // The engine stays pure: nothing it loads touches the database, the network or a model.
  const loaded = [...runtimeImports('lib/assistant/engine.ts')].map(file => file.replace(/\\/g, '/'));
  for (const file of loaded) assert.doesNotMatch(file, /lib\/(ai|bk|search)\/|lib\/db\.ts/, 'engine must not import ' + file);
  assert.ok(loaded.some(file => file.endsWith('lib/chat/funnel.ts')));

  assert.throws(() => parseChatInput({ message: 'hello', history: {} }), InputError);
  assert.throws(() => parseChatInput({ message: ' ' }), InputError);
  assert.throws(() => parseMoreInput({ skip: -1 }), InputError);
  assert.throws(() => parseMoreInput({ filters: { color: {} } }), InputError);
  const chip = { message: 'Pink', refine: { color: 'pink' }, remove: ['brand'] };
  assert.deepEqual([parseChatInput(chip).refine, parseChatInput(chip).remove], [{ color: 'pink' }, ['brand']]);
  for (const bad of [
    { refine: { maxPrice: '500' } }, { refine: { gender: 'boys' } }, { refine: { ageMin: '4' } }, { refine: { size: 'M' } },
    { refine: { color: {} } }, { refine: { color: 'x'.repeat(101) } }, { refine: { color: ' ' } }, { refine: 'party' }, { refine: ['party'] },
    { remove: ['maxPrice'] }, { remove: ['gender'] }, { remove: ['type'] }, { remove: ['category'] }, { remove: ['bogus'] }, { remove: 'color' }, { remove: [{}] },
  ]) assert.throws(() => parseChatInput({ message: 'x', ...bad }), InputError, JSON.stringify(bad));
  assert.equal(parseMoreInput({ filters: { brand: 'midora-2' } }).filters.brand, 'midora-2');
  assert.throws(() => parseMoreInput({ filters: { brand: {} } }), InputError);
  assert.equal(parseChatInput({ message: 'hello', history: Array.from({length:10}, () => ({sender:'user',text:'hi'})) }).history.length, 6);
  let loads = 0;
  const cache = createQueryCache(async () => { loads++; return [1]; }, 2);
  await Promise.all([cache('a'), cache('a')]);
  assert.equal(loads, 1);
  await cache('b'); await cache('c'); await cache('a');
  assert.equal(loads, 4);
  let failures = 0;
  const retryCache = createQueryCache(async () => { if (++failures === 1) throw new Error('temporary'); return 1; });
  await assert.rejects(retryCache('a')); assert.equal(await retryCache('a'), 1);
  const expired = createQueryCache(async () => ++loads, 2, 0);
  await expired('a'); await expired('a'); assert.equal(loads, 6);

  const calls: string[] = [];
  let intent: 'general' | 'product' | 'policy' | 'sizing' = 'general';
  let ready = false;
  let sizingReady = false;
  let batch: ProductSearchResult[] = [];
  // More than one page and more than 8 matches (fewer get no chips): rows 7-10 are only seen by chips.
  const fullPage = [item(1,'red'), item(2,'red'), item(3,'blue'), item(4,'pink'), item(5,'red'), item(6,'blue'), item(7,'green'), item(8,'red'), item(9,'pink', 'sonika'), item(10,'blue', 'sonika')];
  const takes: (number | undefined)[] = [];
  const state = mergeShoppingState(createInitialShoppingState(), {vertical:'clothing', category:'dresses', gender:'girls', ageMin:6, ageMax:6});
  const searches: Filters[] = [];
  const dependencies: AssistantDependencies = {
    catalog: bkCatalog,
    classifyIntent: async () => { calls.push('classify'); return intent; },
    generateGeneralReply: async () => { calls.push('llm:general'); return 'Hello'; },
    handleSizingFlow: async () => { calls.push('llm:sizing'); return sizingReady ? {action:'recommend',reply:'Size 6Y',ageMin:6,ageMax:6,gender:'girls'} : {action:'ask',reply:'How tall?'}; },
    generatePolicyResponse: async (_message, chunks) => { assert.equal(chunks[0].content,'Returns policy'); return { reply: 'Returns answer', suggestions: ['Exchange policy'] }; },
    decideProductConversation: async () => { calls.push('decide'); return {action:ready ? 'search':'ask',reply:'How old?',extractedUpdates:{},updatedState:state,missingFields:[],canSearch:ready,suggestions:[{label:'For a girl 👧'}]}; },
    generateReply: async (_message, _history, _context, refinement) => { calls.push('llm:reply:' + refinement.nextRefinement); return { reply: 'Found options' }; },
    searchProducts: async (filters, query, skip = 0, take) => { calls.push('products:' + skip); searches.push(filters); takes.push(take); assert.ok(query); return batch.slice(0, take); },
    searchPolicyChunks: async () => {calls.push('policy'); return [{heading:'Returns',content:'Returns policy'}];},
  };
  const assistant = createAssistant(dependencies);
  const responses: { suggestions: { label: string }[] }[] = [];
  const chat = async (input: object) => { const response = await assistant.chat(input); responses.push(response); return response; };
  const reset = () => { calls.length = 0; searches.length = 0; takes.length = 0; };

  const general = await chat({message:'hi'});
  assert.equal(general.action, 'general');
  assert.deepEqual(general.suggestions.map(s => s.label), ['Shop for a boy 👦', 'Shop for a girl 👧', 'Party wear 🎉']);
  intent = 'product'; reset();
  const ask = await chat({message:'dress'});
  assert.equal(ask.action, 'ask'); assert.deepEqual(ask.suggestions, [{label:'For a girl 👧'}]); assert.deepEqual(calls, ['classify','decide']);

  // Normal search: one search, one LLM reply, chips from the batch (category is known, so colour comes next).
  ready = true; batch = fullPage; reset();
  const result = await chat({message:'dress',shoppingState:state});
  assert.equal(result.action, 'search'); assert.equal(result.products[0].id, 'p1');
  assert.deepEqual(calls, ['classify','decide','products:0','llm:reply:color']);
  assert.equal(result.nextRefinement, 'color'); assert.equal(result.hasMore, true);
  assert.equal(result.products.length, PAGE_SIZE, 'only one page is shown');
  assert.deepEqual(takes, [CHIP_SAMPLE_SIZE], 'one query with the wider sample limit');
  assert.deepEqual(result.suggestions, [{label:'Red',refine:{color:'red'}},{label:'Blue',refine:{color:'blue'}},{label:'Pink',refine:{color:'pink'}}], 'display names, most common first');

  // Chips see the whole sample: a value only present beyond the shown page still becomes a chip.
  batch = [...Array.from({length: 8}, (_, i) => item(20 + i, 'red')), item(30, 'blue')]; reset();
  const hidden = await chat({message:'dress',shoppingState:state});
  assert.ok(hidden.products.every(p => p.color === 'red'));
  assert.deepEqual(hidden.suggestions.map(s => s.refine), [{color:'red'},{color:'blue'}]);
  assert.deepEqual(calls.filter(c => c.startsWith('products')), ['products:0'], 'no extra query for chips');

  // Refine chip: no intent/decision calls, exactly one search with the added filter; the funnel moves on.
  batch = fullPage.filter(p => p.color !== 'green'); reset();
  const refined = await chat({message:'Red', refine: result.suggestions[0].refine, shoppingState: result.shoppingState});
  assert.deepEqual(calls, ['products:0','llm:reply:brand'], 'refine skips classifyIntent and decideProductConversation');
  assert.equal(searches[0].color, 'red'); assert.equal(searches[0].category, 'dresses'); assert.equal(searches[0].ageMin, 6);
  assert.ok(!refined.searchQuery?.includes('Red'), 'chip label stays out of the search words');
  assert.equal(refined.hasMore, true);
  assert.deepEqual(refined.suggestions.map(s => s.refine), [{brand:'frockwala'},{brand:'sonika'}]);

  // Small sets (8 or fewer matches): products only, no narrowing chips.
  batch = fullPage.slice(0, 8); reset();
  assert.deepEqual((await chat({message:'dress',shoppingState:state})).suggestions, []);

  // Exactly one full page: the extra row check knows there is nothing more (no empty "show more").
  batch = fullPage.slice(0, PAGE_SIZE); reset();
  assert.equal((await chat({message:'dress',shoppingState:state})).hasMore, false);
  batch = fullPage.slice(0, PAGE_SIZE + 1); reset();
  assert.equal((await chat({message:'dress',shoppingState:state})).hasMore, true);

  // A chip tap while something is still unknown asks the next question itself: no model call, no search.
  reset();
  const nextQuestion = await chat({message:'Red', refine: {color:'red'}, shoppingState: createInitialShoppingState()});
  assert.deepEqual(calls, [], 'no intent, decision or search call');
  assert.equal(nextQuestion.action, 'ask');
  assert.match(nextQuestion.reply, /What are you shopping for/);
  assert.ok(nextQuestion.suggestions.length && nextQuestion.suggestions.every(s => s.refine?.vertical), 'department chips refine directly');
  assert.equal(nextQuestion.shoppingState.color, 'red', 'the tapped choice is kept');
  const kindQuestion = await chat({message:'Apparel', refine: nextQuestion.suggestions.find(s => s.refine?.vertical === 'clothing')!.refine, shoppingState: nextQuestion.shoppingState});
  assert.match(kindQuestion.reply, /Which kind of clothes/);
  assert.ok(kindQuestion.suggestions.every(s => s.refine?.category));
  assert.deepEqual(calls, []);

  // Zero results: no relaxation, honest reply naming the filters, remove chips only for optional filters.
  batch = []; reset();
  const strict = mergeShoppingState(state, {color:'red', maxPrice:500, ageMin:4, ageMax:4});
  const none = await chat({message:'Frockwala', refine:{brand:'frockwala'}, shoppingState: strict});
  assert.deepEqual(calls, ['products:0'], 'exactly one search and no LLM call');
  assert.equal(none.reply, "I couldn't find red dresses for girls under ₹500 for age 4 right now. Would you like to drop one of these preferences?");
  assert.deepEqual(none.suggestions, [{label:'Any color',remove:['color']},{label:'Any brand',remove:['brand']}]);
  reset();
  const plain = await chat({message:'dress',shoppingState:state});
  assert.deepEqual(calls.filter(c => c.startsWith('products')), ['products:0'], 'no relaxed retry');
  assert.deepEqual(plain.suggestions, [], 'no optional filters means no chips');
  assert.match(plain.reply, /dresses for girls for age 6/);

  // Remove chip clears the optional filter and keeps everything else.
  batch = fullPage; reset();
  const loosened = await chat({message:'Any color', remove:['color'], shoppingState: strict});
  assert.deepEqual(calls, ['products:0','llm:reply:brand'], '"any color" also stops colour chips');
  assert.equal(searches[0].color, null); assert.equal(searches[0].maxPrice, 500); assert.equal(searches[0].category, 'dresses');
  assert.ok(loosened.shoppingState.unimportantFields.includes('color'));

  // Pagination: zero LLM calls, template reply, chips from the new batch.
  reset();
  const page = await assistant.more({originalQuery:'dress',skip:6,filters:result.filters,shoppingState:state});
  responses.push(page);
  assert.deepEqual(calls, ['products:6'], '/more makes no LLM calls');
  assert.equal(page.reply, 'Here are some more options ✨ Any colour you prefer?');
  assert.equal(page.hasMore, true); assert.equal(page.nextRefinement, 'color');
  batch = fullPage.slice(0, 2); reset();
  const lastPage = await assistant.more({originalQuery:'dress',skip:12,filters:result.filters,shoppingState:state});
  responses.push(lastPage);
  assert.equal(lastPage.hasMore, false);
  batch = fullPage;
  const mismatched = await assistant.more({originalQuery:'dress',skip:6,filters:{ageMin:6,ageMax:6,gender:'girls'},shoppingState:state});
  assert.deepEqual(mismatched.suggestions, [], 'chips only when the batch was fetched with the state filters');

  intent = 'policy'; const policy = await chat({message:'returns'});
  assert.equal(policy.action,'policy'); assert.deepEqual(policy.suggestions, [{label:'Exchange policy'}]);
  intent = 'sizing'; assert.equal((await chat({message:'size'})).action,'ask');
  sizingReady = true; batch = fullPage; reset();
  const sizing = await chat({message:'size'});
  assert.equal(sizing.action,'search');
  assert.ok(sizing.suggestions.every(s => s.refine), 'sizing results (age + gender) narrow with refinement chips');
  assert.deepEqual(calls, ['classify','llm:sizing','products:0']);

  for (const response of responses) {
    for (const suggestion of response.suggestions) {
      assert.doesNotMatch(suggestion.label, /₹|price|budget|under/i, 'price chip: ' + suggestion.label);
    }
  }
  // Catalog outage: a friendly reply, no products, no chips; other errors still surface.
  const down = createAssistant({ ...dependencies, searchProducts: async () => { throw new CatalogUnavailableError('timeout'); } });
  intent = 'product'; ready = true;
  const outage = await down.chat({ message: 'dress', shoppingState: state });
  assert.deepEqual([outage.reply, outage.products, outage.suggestions, outage.hasMore], [CATALOG_UNAVAILABLE_REPLY, [], [], false]);
  const outagePage = await down.more({ originalQuery: 'dress', skip: 6, filters: result.filters, shoppingState: state });
  assert.deepEqual([outagePage.reply, outagePage.products], [CATALOG_UNAVAILABLE_REPLY, []]);
  const broken = createAssistant({ ...dependencies, searchProducts: async () => { throw new Error('bug'); } });
  await assert.rejects(broken.chat({ message: 'dress', shoppingState: state }), /bug/);

  assert.throws(() => parseChatInput(null), InputError);
  console.log('Assistant branches, chip refinement, zero results, adapter isolation, input validation, pagination and cache checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
