import assert from 'node:assert/strict';
import { createAssistant } from '../lib/assistant/engine';
import { InputError, parseChatInput, parseMoreInput } from '../lib/assistant/input';
import { createQueryCache } from '../lib/ai/queryCache';
import { createInitialShoppingState, mergeShoppingState } from '../lib/chat/conversationState';
import type { AssistantDependencies } from '../lib/assistant/contracts';

async function main() {
  assert.throws(() => parseChatInput({ message: 'hello', history: {} }), InputError);
  assert.throws(() => parseChatInput({ message: ' ' }), InputError);
  assert.throws(() => parseMoreInput({ skip: -1 }), InputError);
  assert.throws(() => parseMoreInput({ filters: { color: {} } }), InputError);
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
  const product = {id:1,name:'Dress',price:500,imageUrl:'',color:'pink',size:'6Y'};
  const state = mergeShoppingState(createInitialShoppingState(), {type:'dress', gender:'girls',ageMin:6,ageMax:6});
  const dependencies: AssistantDependencies = {
    classifyIntent: async () => intent,
    generateGeneralReply: async () => 'Hello',
    handleSizingFlow: async () => sizingReady ? {action:'recommend',reply:'Size 6Y',ageMin:6,ageMax:6,gender:'girls'} : {action:'ask',reply:'How tall?'},
    generatePolicyResponse: async (_message, chunks) => { assert.equal(chunks[0].content,'Returns policy'); return { reply: 'Returns answer', suggestions: ['Exchange policy'] }; },
    decideProductConversation: async () => ({action:ready ? 'search':'ask',reply:'How old?',extractedUpdates:{},updatedState:state,missingFields:[],canSearch:ready}),
    generateReply: async () => ({reply:'Found options',suggestions:['Try blue']}),
    generateContextualSuggestions: async (_history, context) => { calls.push('suggestions:' + context.offset); return ['Try blue']; },
    searchProducts: async (_filters, query, skip = 0) => {calls.push('products:' + skip); assert.ok(query); return [product];},
    searchPolicyChunks: async () => {calls.push('policy'); return [{heading:'Returns',content:'Returns policy'}];},
  };
  const assistant = createAssistant(dependencies);
  assert.equal((await assistant.chat({message:'hi'})).action, 'general'); assert.deepEqual(calls, []);
  intent = 'product'; assert.equal((await assistant.chat({message:'dress'})).action, 'ask'); assert.deepEqual(calls, []);
  ready = true; const result = await assistant.chat({message:'dress',shoppingState:state});
  assert.equal(result.action, 'search'); assert.equal(result.products[0].id, 1);
  await assistant.more({originalQuery:'dress',skip:12,shoppingState:state});
  assert.deepEqual(calls, ['products:0','products:12','suggestions:12']);
  intent = 'policy'; assert.equal((await assistant.chat({message:'returns'})).action,'policy');
  intent = 'sizing'; assert.equal((await assistant.chat({message:'size'})).action,'ask');
  sizingReady = true; assert.equal((await assistant.chat({message:'size'})).action,'search');
  assert.throws(() => parseChatInput(null), InputError);
  console.log('Assistant branches, adapter isolation, input validation, pagination and cache checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
