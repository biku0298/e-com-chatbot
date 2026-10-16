import assert from 'node:assert/strict';
import { classifyIntent } from '../lib/chat/intent';
import { decideProductConversation } from '../lib/chat/conversationDecision';
import { createInitialShoppingState, mergeShoppingState, validateAndNormalizeShoppingState, canSearch, toSearchFilters } from '../lib/chat/conversationState';
import { generatePolicyResponse } from '../lib/chat/policy';
import { generateReply } from '../lib/chat/suggestions';
import { buildFunnelChips, buildRemoveChips, describeFilters } from '../lib/chat/suggestions';
import type { Filters, HistoryMessage, ProductSearchResult } from '../lib/chat/types';

const NO_PRICE_LABEL = /₹|price|budget|under/i;

/** In-memory mirror of the product search WHERE clause. */
function matches(product: ProductSearchResult & { minAge: number; maxAge: number; category: string }, filters: Filters) {
  return (!filters.category || product.category === filters.category)
    && (!filters.type || product.type === filters.type)
    && (!filters.gender || product.gender === filters.gender)
    && (filters.maxPrice == null || product.price <= filters.maxPrice)
    && (filters.ageMin == null || product.maxAge >= filters.ageMin)
    && (filters.ageMax == null || product.minAge <= filters.ageMax)
    && (!filters.occasion || product.occasion === filters.occasion)
    && (!filters.color || product.color === filters.color)
    && (!filters.fit || product.fit === filters.fit);
}

function funnelChecks() {
  const item = (id: number, type: string, occasion: string, color: string, fit: string, category = 'bottomwear') =>
    ({ id, name: `${color} ${type}`, price: 400 + id, imageUrl: '', size: '6Y', gender: 'girls', minAge: 5, maxAge: 7, category, type, occasion, color, fit });
  const batch = [
    item(1, 'dress', 'party', 'red', 'slim'),
    item(2, 'dress', 'party', 'blue', 'slim'),
    item(3, 'dress', 'ethnic', 'red', 'regular'),
    item(4, 'skirt', 'casual', 'pink', 'relaxed'),
    item(5, 'dress', 'party', 'red', 'regular'),
  ];
  const dressState = mergeShoppingState(createInitialShoppingState(), { type: 'dress', gender: 'girls', ageMin: 6, ageMax: 6, maxPrice: 500 });
  const dresses = batch.filter(p => p.type === 'dress');

  const first = buildFunnelChips(dressState, dresses);
  assert.equal(first.nextRefinement, 'occasion', 'type is set, so the funnel starts at occasion');
  assert.deepEqual(first.chips.map(c => c.refine), [{ occasion: 'party' }, { occasion: 'ethnic' }], 'most frequent first, only batch values');
  assert.deepEqual(first.chips.map(c => c.label), ['Party wear 🎉', 'Ethnic & festive 🪷']);

  const party = mergeShoppingState(dressState, { occasion: 'party' });
  const partyBatch = dresses.filter(p => p.occasion === 'party');
  assert.equal(buildFunnelChips(party, partyBatch).nextRefinement, 'color');
  const singleColor = partyBatch.filter(p => p.color === 'red');
  const fitOnly = buildFunnelChips(party, singleColor);
  assert.equal(fitOnly.nextRefinement, 'fit', 'a field with fewer than 2 values is skipped');
  assert.deepEqual(fitOnly.chips.map(c => c.label), ['Slim fit', 'Regular fit']);
  const noColor = mergeShoppingState(party, { unimportantFields: ['color'] });
  assert.equal(buildFunnelChips(noColor, partyBatch).nextRefinement, 'fit', 'unimportant fields are skipped');
  assert.deepEqual(buildFunnelChips(party, [partyBatch[0]]), { chips: [], nextRefinement: null });

  const category = mergeShoppingState(createInitialShoppingState(), { category: 'bottomwear', gender: 'girls', ageMin: 6, ageMax: 6 });
  assert.equal(buildFunnelChips(category, batch).nextRefinement, 'type', 'type only opens under a bare category');
  assert.deepEqual(buildFunnelChips(category, batch).chips[0], { label: 'Dresses', refine: { type: 'dress' } });
  assert.equal(buildFunnelChips(mergeShoppingState(createInitialShoppingState(), { gender: 'girls' }), batch).nextRefinement, 'occasion');
  assert.notEqual(buildFunnelChips(dressState, [{ ...batch[0], occasion: 'Party ' }, batch[2]]).nextRefinement, 'occasion', 'non-normalized values are never offered');

  // Guarantee: every chip, applied to the state, still matches a product of the same batch.
  for (const state of [dressState, party, noColor, category]) {
    const shown = batch.filter(p => matches(p, toSearchFilters(state)));
    const { chips } = buildFunnelChips(state, shown);
    for (const chip of chips) {
      assert.ok(chip.refine && !chip.remove);
      assert.doesNotMatch(chip.label, NO_PRICE_LABEL);
      assert.ok(Object.keys(chip.refine).every(key => key !== 'maxPrice'));
      const refined = toSearchFilters(mergeShoppingState(state, chip.refine));
      assert.ok(shown.filter(p => matches(p, refined)).length >= 1, 'chip leads to products: ' + chip.label);
      assert.ok(shown.filter(p => matches(p, refined)).length < shown.length, 'chip narrows: ' + chip.label);
    }
  }

  const strict = mergeShoppingState(dressState, { color: 'red', occasion: 'party', ageMin: 4, ageMax: 4 });
  assert.equal(describeFilters(strict), 'red party dresses for girls under ₹500 for age 4');
  assert.deepEqual(buildRemoveChips(strict), [{ label: 'Any occasion', remove: ['occasion'] }, { label: 'Any color', remove: ['color'] }]);
  assert.deepEqual(buildRemoveChips(dressState), [], 'price, gender, age and type are never removable');
}

function fakeModel(value: unknown, fail = false) {
  const prompts: string[] = [];
  return {
    prompts,
    generateContent: async (prompt: string) => {
      prompts.push(prompt);
      if (fail) throw new Error('Offline simulated failure');
      return { response: { text: () => typeof value === 'string' ? value : JSON.stringify(value) } };
    },
  };
}

async function main() {
  const initial = createInitialShoppingState();
  const shopping = mergeShoppingState(initial, { intent:'product', type:'dress', gender:'girls' });
  const ageQuestion: HistoryMessage[] = [{sender:'bot',text:'How old is the child?'}];
  const unusedModel = fakeModel('general');
  for (const reply of ['6', 'six', '6 years old', '5-7']) {
    assert.equal(await classifyIntent(unusedModel, reply, ageQuestion, shopping), 'product');
    assert.equal(await classifyIntent(unusedModel, reply, ageQuestion, {...shopping,intent:'sizing'}), 'sizing');
  }
  assert.equal(await classifyIntent(unusedModel, '110 cm', ageQuestion, {...shopping,intent:'sizing'}), 'sizing');
  assert.equal(await classifyIntent(unusedModel, 'returns within 7 days?', ageQuestion, shopping), 'policy');
  assert.equal(await classifyIntent(unusedModel, 'show shirts', ageQuestion, {...shopping,intent:'sizing'}), 'product');
  assert.equal(unusedModel.prompts.length, 0, 'Unambiguous follow-ups should not need classification calls');

  const normalized = validateAndNormalizeShoppingState({type:' Dress ',gender:' GIRLS ',ageMin:'6',ageMax:'4',maxPrice:'1k',missingFields:[],isReadyForSearch:false});
  assert.deepEqual([normalized.type,normalized.gender,normalized.ageMin,normalized.ageMax,normalized.maxPrice], ['dress','girls',4,6,1000]);
  assert.equal(canSearch(normalized), true);
  const malformed = validateAndNormalizeShoppingState({type:{},gender:[],ageMin:Infinity,ageMax:-2,maxPrice:Infinity,unimportantFields:['bogus','color','color'],isReadyForSearch:true});
  assert.equal(malformed.isReadyForSearch, false);
  assert.deepEqual(malformed.unimportantFields, ['color']);
  assert.equal(malformed.ageMin, null);
  const irrelevant = mergeShoppingState(initial, {unimportantFields:['category','gender','age']});
  assert.equal(irrelevant.isReadyForSearch, true);
  assert.deepEqual(irrelevant.missingFields, []);
  assert.equal(canSearch(irrelevant), true);

  const known = mergeShoppingState(shopping, {age:6,color:'red',maxPrice:1000});
  const corrected = await decideProductConversation(fakeModel({extracted:{color:'blue',maxPrice:'800'},question:'Any preferred occasion?',suggestions:['Party wear']}), 'Blue and under 800', [], known);
  assert.equal(corrected.action, 'search', 'Optional model question must not block a ready search');
  assert.deepEqual([corrected.updatedState.type,corrected.updatedState.ageMin,corrected.updatedState.color,corrected.updatedState.maxPrice], ['dress',6,'blue',800]);
  const anyColor = await decideProductConversation(fakeModel({extracted:{color:'red'}}), 'Any color', [], known);
  assert.equal(toSearchFilters(anyColor.updatedState).color, null);
  const blueAgain = await decideProductConversation(fakeModel({extracted:{color:'blue'}}), 'Actually blue', [], anyColor.updatedState);
  assert.equal(toSearchFilters(blueAgain.updatedState).color, 'blue');
  const missing = await decideProductConversation(fakeModel({extracted:{type:'dress'},question:null}), 'A dress', [], initial);
  assert.equal(missing.action, 'ask');
  assert.ok(missing.missingFields.includes('age'));
  assert.match(missing.reply, /boy or a girl/);

  for (const response of ['not json', {extracted:null}, {extracted:[]}]) {
    const fallback = await decideProductConversation(fakeModel(response), 'dress for my 6 year old daughter under 500', [], initial);
    assert.equal(fallback.action, 'search');
    assert.equal(fallback.updatedState.maxPrice, 500);
  }
  const failed = await decideProductConversation(fakeModel(null,true), '6', ageQuestion, shopping);
  assert.equal(failed.action, 'search');
  for (const reply of ['6', 'six', 'between 5 and 7', '5-7']) {
    const result = await decideProductConversation(fakeModel('invalid'), reply, ageQuestion, shopping);
    assert.equal(result.action, 'search', reply);
  }
  for (const message of ['under 10', 'two shirts', 'one thousand rupees', '6 months old', '110 cm', 'age -1', 'age 6 months', 'she is 6 months']) {
    const result = await decideProductConversation(fakeModel('invalid'), message, ageQuestion, shopping);
    assert.equal(result.updatedState.ageMin, null, 'False age in: ' + message);
    assert.equal(result.action, 'ask');
  }
  const ageRange = await decideProductConversation(fakeModel('invalid'), 'between 5 and 7 years', [], shopping);
  assert.deepEqual([ageRange.updatedState.ageMin,ageRange.updatedState.ageMax], [5,7]);
  const numberWord = await decideProductConversation(fakeModel('invalid'), "she's six", [], shopping);
  assert.equal(numberWord.updatedState.ageMin,6);

  const policyModel = fakeModel({reply:'Returns are allowed within 7 days.',suggestions:['Can I exchange?','Extra']});
  const policy = await generatePolicyResponse(policyModel,'Returns?', [{heading:'Returns',content:'Returns within 7 days.'}], []);
  assert.equal(policyModel.prompts.length,1);
  assert.equal(policy.suggestions.length,1);
  const emptyModel=fakeModel({});
  assert.deepEqual((await generatePolicyResponse(emptyModel,'Returns?',[],[])).suggestions,[]);
  assert.equal(emptyModel.prompts.length,0);
  const badPolicy=await generatePolicyResponse(fakeModel('not json'),'Returns?',[{heading:null,content:'Returns within 7 days.'}],[]);
  assert.match(badPolicy.reply,/trouble checking/);

  const resultModel=fakeModel({reply:'Some lovely choices! Any particular style in mind?',suggestions:['Show under ₹1000']});
  const context={shoppingState:known,originalQuery:'dress',offset:0,products:[{id:1,name:'Dress',price:500,imageUrl:'',color:'red',size:'6Y'}]};
  const refinement={nextRefinement:'occasion' as const,labels:['Party wear 🎉','Casual wear 👕']};
  const result=await generateReply(resultModel,'A dress',[],context,refinement);
  assert.deepEqual(result,{reply:'Some lovely choices! Any particular style in mind?'},'reply only, model chips ignored');
  assert.equal(resultModel.prompts.length,1);
  assert.match(resultModel.prompts[0],/style or occasion/);
  assert.match(resultModel.prompts[0],/do not list, name or describe them/);
  assert.doesNotMatch(resultModel.prompts[0],/Party wear|Casual wear/,'chip labels are not fed to the model');
  assert.equal((await generateReply(fakeModel({reply:'Narrow them down by selecting Party wear or Casual wear below.'}),'A dress',[],context,refinement)).reply,'Here are some lovely picks ✨ Any particular style in mind?','replies that repeat the chips fall back to template');
  assert.doesNotMatch(resultModel.prompts[0],/₹500|Price range/,'prompt carries no prices');
  assert.equal((await generateReply(fakeModel({reply:'Great picks under ₹500!'}),'A dress',[],context,refinement)).reply,'Here are some lovely picks ✨ Any particular style in mind?','price talk falls back to template');
  assert.equal((await generateReply(fakeModel('not json'),'A dress',[],context,{nextRefinement:null,labels:[]})).reply,'Here are some lovely picks ✨');
  const askModel=fakeModel({extracted:{type:'dress'},question:'Who is it for?',suggestions:['For a girl 👧','Under ₹500','Budget picks','Cheap ones']});
  assert.deepEqual((await decideProductConversation(askModel,'A dress',[],initial)).suggestions,['For a girl 👧'],'ask chips never mention price');
  funnelChecks();
  console.log('Chat logic regression checks passed (state, corrections, routing, fallback ages, policy, suggestions and funnel chips).');
}
main().catch(error => {console.error(error);process.exitCode=1;});
