import assert from 'node:assert/strict';
import { classifyIntent } from '../lib/chat/intent';
import { decideProductConversation } from '../lib/chat/conversationDecision';
import { createInitialShoppingState, mergeShoppingState, validateAndNormalizeShoppingState, canSearch, toSearchFilters } from '../lib/chat/conversationState';
import { generatePolicyResponse } from '../lib/chat/policy';
import { generateReply, generateContextualSuggestions } from '../lib/chat/suggestions';
import type { HistoryMessage } from '../lib/chat/types';

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

  const resultModel=fakeModel({reply:'Some lovely choices!',suggestions:['Show more','Try blue','Try blue','Try party wear']});
  const context={shoppingState:known,originalQuery:'dress',offset:12,products:[{id:1,name:'Dress',price:500,imageUrl:'',color:'red',size:'6Y'}]};
  assert.deepEqual((await generateReply(resultModel,'A dress','',[],context)).suggestions,['Try blue','Try party wear']);
  assert.deepEqual(await generateContextualSuggestions(resultModel,[],context),['Try blue','Try party wear']);
  assert.equal(resultModel.prompts.length,2, 'Each results batch gets fresh suggestions');
  assert.match(resultModel.prompts[1],/Pagination Offset: 12/);
  const empty=await generateReply(fakeModel('not json'),'A dress','',[],{...context,products:[]});
  assert.match(empty.reply,/Couldn't find an exact match/);
  assert.ok(empty.suggestions.length>=2);
  console.log('Chat logic regression checks passed (state, corrections, routing, fallback ages, policy and suggestions).');
}
main().catch(error => {console.error(error);process.exitCode=1;});
