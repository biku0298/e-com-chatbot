import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CATALOG_UNAVAILABLE_REPLY, createAssistant } from '../lib/assistant/engine';
import { CatalogUnavailableError } from '../lib/catalog/errors';
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

async function main() {
  // The engine stays pure: nothing it loads touches the database, the network or a model.
  const loaded = [...runtimeImports('lib/assistant/engine.ts')].map(file => file.replace(/\\/g, '/'));
  for (const file of loaded) assert.doesNotMatch(file, /lib\/(ai|bk|search)\/|lib\/db\.ts/, 'engine must not import ' + file);
  assert.ok(loaded.some(file => file.endsWith('lib/catalog/fakeCatalog.ts')));

  assert.throws(() => parseChatInput({ message: 'hello', history: {} }), InputError);
  assert.throws(() => parseChatInput({ message: ' ' }), InputError);
  assert.throws(() => parseMoreInput({ skip: -1 }), InputError);
  assert.throws(() => parseMoreInput({ filters: { color: {} } }), InputError);
  const chip = { message: 'Party wear', refine: { occasion: 'party' }, remove: ['color'] };
  assert.deepEqual([parseChatInput(chip).refine, parseChatInput(chip).remove], [{ occasion: 'party' }, ['color']]);
  for (const bad of [
    { refine: { maxPrice: '500' } }, { refine: { gender: 'boys' } }, { refine: { ageMin: '4' } }, { refine: { size: 'M' } },
    { refine: { color: {} } }, { refine: { color: 'x'.repeat(51) } }, { refine: { color: ' ' } }, { refine: 'party' }, { refine: ['party'] },
    { remove: ['maxPrice'] }, { remove: ['gender'] }, { remove: ['type'] }, { remove: ['bogus'] }, { remove: 'color' }, { remove: [{}] },
  ]) assert.throws(() => parseChatInput({ message: 'x', ...bad }), InputError, JSON.stringify(bad));
  assert.equal(parseMoreInput({ filters: { fit: 'slim' } }).filters.fit, 'slim');
  assert.throws(() => parseMoreInput({ filters: { fit: {} } }), InputError);
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
  const item = (id: number, occasion: string, color: string) => ({ id, name: 'Dress', price: 450, imageUrl: '', color, size: '6Y', gender: 'girls', type: 'dress', category: 'bottomwear', occasion, fit: 'slim' });
  // More rows than one page: rows 7–8 are only seen by chips and the "more pages" check.
  const fullPage = [item(1,'party','red'), item(2,'party','blue'), item(3,'ethnic','red'), item(4,'casual','pink'), item(5,'party','red'), item(6,'ethnic','blue'), item(7,'party','green'), item(8,'casual','red')];
  const takes: (number | undefined)[] = [];
  const state = mergeShoppingState(createInitialShoppingState(), {type:'dress', gender:'girls',ageMin:6,ageMax:6});
  const searches: Filters[] = [];
  const dependencies: AssistantDependencies = {
    classifyIntent: async () => { calls.push('classify'); return intent; },
    generateGeneralReply: async () => { calls.push('llm:general'); return 'Hello'; },
    handleSizingFlow: async () => { calls.push('llm:sizing'); return sizingReady ? {action:'recommend',reply:'Size 6Y',ageMin:6,ageMax:6,gender:'girls'} : {action:'ask',reply:'How tall?'}; },
    generatePolicyResponse: async (_message, chunks) => { assert.equal(chunks[0].content,'Returns policy'); return { reply: 'Returns answer', suggestions: ['Exchange policy'] }; },
    decideProductConversation: async () => { calls.push('decide'); return {action:ready ? 'search':'ask',reply:'How old?',extractedUpdates:{},updatedState:state,missingFields:[],canSearch:ready,suggestions:['For a girl 👧']}; },
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

  // Normal search: one search, one LLM reply, chips from the batch.
  ready = true; batch = fullPage; reset();
  const result = await chat({message:'dress',shoppingState:state});
  assert.equal(result.action, 'search'); assert.equal(result.products[0].id, 1);
  assert.deepEqual(calls, ['classify','decide','products:0','llm:reply:occasion']);
  assert.equal(result.nextRefinement, 'occasion'); assert.equal(result.hasMore, true);
  assert.equal(result.products.length, PAGE_SIZE, 'only one page is shown');
  assert.deepEqual(takes, [CHIP_SAMPLE_SIZE], 'one query with the wider sample limit');
  assert.deepEqual(result.suggestions.map(s => s.refine), [{occasion:'party'},{occasion:'ethnic'},{occasion:'casual'}]);

  // Chips see the whole sample: a value only present beyond the shown page still becomes a chip.
  batch = [...Array.from({length: 6}, (_, i) => item(20 + i, 'party', 'red')), item(30, 'casual', 'red')]; reset();
  const hidden = await chat({message:'dress',shoppingState:state});
  assert.ok(hidden.products.every(p => p.occasion === 'party'));
  assert.deepEqual(hidden.suggestions.map(s => s.refine), [{occasion:'party'},{occasion:'casual'}]);
  assert.deepEqual(calls.filter(c => c.startsWith('products')), ['products:0'], 'no extra query for chips');

  // Refine chip: no intent/decision calls, exactly one search with the added filter.
  batch = fullPage.filter(p => p.occasion === 'party'); reset();
  const refined = await chat({message:'Party wear 🎉', refine: result.suggestions[0].refine, shoppingState: result.shoppingState});
  assert.deepEqual(calls, ['products:0','llm:reply:color'], 'refine skips classifyIntent and decideProductConversation');
  assert.equal(searches[0].occasion, 'party'); assert.equal(searches[0].type, 'dress'); assert.equal(searches[0].ageMin, 6);
  assert.ok(!refined.searchQuery?.includes('🎉'), 'chip label stays out of the embedding query');
  assert.equal(refined.hasMore, false, 'short batch has no more pages');
  assert.deepEqual(refined.suggestions.map(s => s.refine), [{color:'red'},{color:'blue'},{color:'green'}]);

  // Exactly one full page: the extra row check knows there is nothing more (no empty "show more").
  batch = fullPage.slice(0, PAGE_SIZE); reset();
  assert.equal((await chat({message:'dress',shoppingState:state})).hasMore, false);
  batch = fullPage.slice(0, PAGE_SIZE + 1); reset();
  assert.equal((await chat({message:'dress',shoppingState:state})).hasMore, true);

  // Refine is ignored when the incoming state is not search-ready: normal text flow.
  reset();
  await chat({message:'Party wear 🎉', refine: {occasion:'party'}, shoppingState: createInitialShoppingState()});
  assert.deepEqual(calls.slice(0, 2), ['classify','decide']);

  // Zero results: no relaxation, honest reply naming the filters, remove chips only for optional filters.
  batch = []; reset();
  const strict = mergeShoppingState(state, {color:'red', occasion:'party', maxPrice:500, ageMin:4, ageMax:4});
  const none = await chat({message:'Slim fit', refine:{fit:'slim'}, shoppingState: strict});
  assert.deepEqual(calls, ['products:0'], 'exactly one search and no LLM call');
  assert.equal(none.reply, "I couldn't find red party slim-fit dresses for girls under ₹500 for age 4 right now. Would you like to drop one of these preferences?");
  assert.deepEqual(none.suggestions, [{label:'Any occasion',remove:['occasion']},{label:'Any color',remove:['color']},{label:'Any fit',remove:['fit']}]);
  reset();
  const plain = await chat({message:'dress',shoppingState:state});
  assert.deepEqual(calls.filter(c => c.startsWith('products')), ['products:0'], 'no relaxed retry');
  assert.deepEqual(plain.suggestions, [], 'no optional filters means no chips');
  assert.match(plain.reply, /dresses for girls for age 6/);

  // Remove chip clears the optional filter and keeps everything else.
  batch = fullPage; reset();
  const loosened = await chat({message:'Any color', remove:['color'], shoppingState: strict});
  assert.deepEqual(calls, ['products:0','llm:reply:null']);
  assert.equal(searches[0].color, null); assert.equal(searches[0].maxPrice, 500); assert.equal(searches[0].occasion, 'party');
  assert.ok(loosened.shoppingState.unimportantFields.includes('color'));

  // Pagination: zero LLM calls, template reply, chips from the new batch.
  reset();
  const page = await assistant.more({originalQuery:'dress',skip:6,filters:result.filters,shoppingState:state});
  responses.push(page);
  assert.deepEqual(calls, ['products:6'], '/more makes no LLM calls');
  assert.equal(page.reply, 'Here are some more options ✨ Any particular style in mind?');
  assert.equal(page.hasMore, true); assert.equal(page.nextRefinement, 'occasion');
  batch = fullPage.slice(0, 2); reset();
  const lastPage = await assistant.more({originalQuery:'dress',skip:12,filters:result.filters,shoppingState:state});
  responses.push(lastPage);
  assert.equal(lastPage.hasMore, false);
  const mismatched = await assistant.more({originalQuery:'dress',skip:6,filters:{ageMin:6,ageMax:6,gender:'girls'},shoppingState:state});
  assert.deepEqual(mismatched.suggestions, [], 'chips only when the batch was fetched with the state filters');

  intent = 'policy'; const policy = await chat({message:'returns'});
  assert.equal(policy.action,'policy'); assert.deepEqual(policy.suggestions, [{label:'Exchange policy'}]);
  intent = 'sizing'; assert.equal((await chat({message:'size'})).action,'ask');
  sizingReady = true; batch = fullPage; reset();
  const sizing = await chat({message:'size'});
  assert.equal(sizing.action,'search'); assert.deepEqual(sizing.suggestions, [], 'sizing state is not search-ready, so no funnel chips');
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
