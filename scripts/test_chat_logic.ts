import assert from 'node:assert/strict';
import { classifyIntent } from '../lib/chat/intent';
import { decideProductConversation as decide } from '../lib/chat/conversationDecision';
import { createInitialShoppingState, mergeShoppingState, validateAndNormalizeShoppingState, toSearchFilters } from '../lib/chat/conversationState';
import { generatePolicyResponse } from '../lib/chat/policy';
import { generateReply } from '../lib/chat/suggestions';
import { bkCatalog } from '../lib/catalog/bkCatalog';
import type { HistoryMessage, ShoppingState } from '../lib/chat/types';

/** The decision step with the store's catalog rules. */
const decideProductConversation = (model: unknown, message: string, history: HistoryMessage[], state: ShoppingState) => decide(model, message, history, state, bkCatalog);
const ready = (state: ShoppingState) => bkCatalog.missingFields(state).length === 0;

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
  const shopping = mergeShoppingState(initial, { intent:'product', vertical:'clothing', category:'dresses', gender:'girls' });
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
  assert.equal(normalized.isReadyForSearch, false, 'client-sent readiness is ignored');
  const malformed = validateAndNormalizeShoppingState({type:{},gender:[],ageMin:Infinity,ageMax:-2,maxPrice:Infinity,unimportantFields:['bogus','color','color'],isReadyForSearch:true});
  assert.equal(malformed.isReadyForSearch, false);
  assert.deepEqual(malformed.unimportantFields, ['color']);
  assert.equal(malformed.ageMin, null);
  // Readiness comes from the catalog: dresses need gender and age; an age alone allows a store-wide search.
  assert.deepEqual(bkCatalog.missingFields(mergeShoppingState(initial, {category:'dresses'})), ['gender','age']);
  assert.equal(ready(mergeShoppingState(initial, {category:'dresses', gender:'girls', unimportantFields:['age']})), true);
  assert.equal(ready(mergeShoppingState(initial, {ageMin:4, ageMax:4})), true);
  assert.deepEqual(bkCatalog.missingFields(initial), ['type']);

  const known = mergeShoppingState(shopping, {age:6,color:'red',maxPrice:1000});
  const corrected = await decideProductConversation(fakeModel({extracted:{item:null,color:'blue',maxPrice:'800'},question:'Any preferred occasion?',suggestions:['Party wear']}), 'Blue and under 800', [], known);
  assert.equal(corrected.action, 'search', 'Optional model question must not block a ready search');
  assert.deepEqual([corrected.updatedState.category,corrected.updatedState.ageMin,corrected.updatedState.maxPrice], ['dresses',6,800], 'a colour correction keeps the item');
  assert.ok(corrected.updatedState.color!.split(',').includes('blue') && !corrected.updatedState.color!.includes('red'));
  const anyColor = await decideProductConversation(fakeModel({extracted:{color:'red'}}), 'Any color', [], known);
  assert.equal(toSearchFilters(anyColor.updatedState).color, null);
  const blueAgain = await decideProductConversation(fakeModel({extracted:{color:'blue'}}), 'Actually blue', [], anyColor.updatedState);
  assert.ok(toSearchFilters(blueAgain.updatedState).color!.split(',').includes('blue'));
  const missing = await decideProductConversation(fakeModel({extracted:{item:'dress'},question:null}), 'A dress', [], initial);
  assert.equal(missing.action, 'ask');
  assert.ok(missing.missingFields.includes('age'));
  assert.match(missing.reply, /boy or a girl/);

  for (const response of ['not json', {extracted:null}, {extracted:[]}]) {
    const fallback = await decideProductConversation(fakeModel(response), 'dress for my 6 year old daughter under 500', [], initial);
    assert.equal(fallback.action, 'search');
    assert.deepEqual([fallback.updatedState.category, fallback.updatedState.gender, fallback.updatedState.ageMin, fallback.updatedState.maxPrice], ['dresses', 'girls', 6, 500]);
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
  const context={shoppingState:known,originalQuery:'dress',offset:0,products:[{id:'p1',name:'Dress',price:500,imageUrl:'',color:'red',size:'6Y'}]};
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
  // The store asks its own questions; a catalog that trusts the model still never shows price chips.
  const askModel=fakeModel({extracted:{item:'dress'},question:'Who is it for?',suggestions:['For a girl 👧','Under ₹500','Budget picks','Cheap ones']});
  const fixedQuestion = await decideProductConversation(askModel,'A dress',[],initial);
  assert.deepEqual([fixedQuestion.reply, fixedQuestion.suggestions], ['Sounds great! Is this for a boy or a girl?', ['For a boy 👦','For a girl 👧']]);
  const trusting = await decide(askModel,'A dress',[],initial,{...bkCatalog, useModelQuestion:true});
  assert.deepEqual(trusting.suggestions,['For a girl 👧'],'ask chips never mention price');
  console.log('Chat logic regression checks passed (state, readiness, corrections, routing, fallback ages, policy and replies).');
}
main().catch(error => {console.error(error);process.exitCode=1;});
