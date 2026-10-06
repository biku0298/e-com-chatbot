import { createInitialShoppingState, mergeShoppingState, canSearch, calculateMissingFields, toSearchFilters } from '../lib/chat/conversationState';
import { decideProductConversation } from '../lib/chat/conversationDecision';
import { getChatModel } from '../lib/ai/gemini';
import dotenv from 'dotenv';
import path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function runTests() {
  console.log('====================================================');
  console.log('RUNNING CONVERSATION DECISION TEST SUITE');
  console.log('====================================================\n');

  const model = getChatModel();
  let passedCount = 0;
  let totalCount = 8;

  // Test Case 1: "Show me a dress" -> ask gender
  console.log('--- Test 1: "Show me a dress" ---');
  let state1 = createInitialShoppingState();
  const res1 = await decideProductConversation(model, 'Show me a dress', [], state1);
  console.log('Action:', res1.action);
  console.log('Reply:', res1.reply);
  console.log('Missing fields:', res1.missingFields);
  console.log('Type:', res1.updatedState.type);
  console.log('Gender:', res1.updatedState.gender);
  if (res1.action === 'ask' && res1.missingFields.includes('gender') && res1.updatedState.type === 'dress') {
    console.log('✅ Test 1 Passed: Asks gender, type=dress captured\n');
    passedCount++;
  } else {
    console.log('❌ Test 1 Failed\n');
  }

  // Test Case 2: "Show me a dress for Diwali" -> ask gender
  console.log('--- Test 2: "Show me a dress for Diwali" ---');
  let state2 = createInitialShoppingState();
  const res2 = await decideProductConversation(model, 'Show me a dress for Diwali', [], state2);
  console.log('Action:', res2.action);
  console.log('Reply:', res2.reply);
  console.log('Occasion:', res2.updatedState.occasion);
  console.log('Missing fields:', res2.missingFields);
  if (res2.action === 'ask' && res2.missingFields.includes('gender') && res2.updatedState.occasion === 'ethnic') {
    console.log('✅ Test 2 Passed: Asks gender, occasion=ethnic captured\n');
    passedCount++;
  } else {
    console.log('❌ Test 2 Failed\n');
  }

  // Test Case 3: "Show me a dress for my daughter" -> ask age
  console.log('--- Test 3: "Show me a dress for my daughter" ---');
  let state3 = createInitialShoppingState();
  const res3 = await decideProductConversation(model, 'Show me a dress for my daughter', [], state3);
  console.log('Action:', res3.action);
  console.log('Reply:', res3.reply);
  console.log('Gender:', res3.updatedState.gender);
  console.log('Missing fields:', res3.missingFields);
  if (res3.action === 'ask' && res3.missingFields.includes('age') && !res3.missingFields.includes('gender') && res3.updatedState.gender === 'girls') {
    console.log('✅ Test 3 Passed: Asks age, gender=girls captured\n');
    passedCount++;
  } else {
    console.log('❌ Test 3 Failed\n');
  }

  // Test Case 4: "Show me a dress for my 6 year old daughter" -> ready to search
  console.log('--- Test 4: "Show me a dress for my 6 year old daughter" ---');
  let state4 = createInitialShoppingState();
  const res4 = await decideProductConversation(model, 'Show me a dress for my 6 year old daughter', [], state4);
  console.log('Action:', res4.action);
  console.log('CanSearch:', res4.canSearch);
  console.log('Gender:', res4.updatedState.gender);
  console.log('AgeMin:', res4.updatedState.ageMin, 'AgeMax:', res4.updatedState.ageMax);
  if (res4.action === 'search' && res4.canSearch && res4.updatedState.gender === 'girls' && res4.updatedState.ageMin === 6) {
    console.log('✅ Test 4 Passed: Ready to search\n');
    passedCount++;
  } else {
    console.log('❌ Test 4 Failed\n');
  }

  // Test Case 5: "Blue dress for my 7 year old daughter under ₹1000" -> ready immediately
  console.log('--- Test 5: "Blue dress for my 7 year old daughter under ₹1000" ---');
  let state5 = createInitialShoppingState();
  const res5 = await decideProductConversation(model, 'Blue dress for my 7 year old daughter under ₹1000', [], state5);
  console.log('Action:', res5.action);
  console.log('CanSearch:', res5.canSearch);
  console.log('Color:', res5.updatedState.color);
  console.log('MaxPrice:', res5.updatedState.maxPrice);
  if (res5.action === 'search' && res5.canSearch && res5.updatedState.color === 'blue' && res5.updatedState.maxPrice === 1000) {
    console.log('✅ Test 5 Passed: Ready immediately with color and budget\n');
    passedCount++;
  } else {
    console.log('❌ Test 5 Failed\n');
  }

  // Test Case 6: "Actually it's for my son" -> gender changes to boys
  console.log('--- Test 6: "Actually it\'s for my son" ---');
  // Prior state had gender = girls
  let state6 = mergeShoppingState(createInitialShoppingState(), {
    type: 'shirt',
    gender: 'girls',
    ageMin: 5,
    ageMax: 5,
  });
  console.log('Initial gender:', state6.gender);
  const res6 = await decideProductConversation(model, "Actually it's for my son", [
    { sender: 'user', text: 'Show me shirts for my 5 year old daughter' },
    { sender: 'bot', text: 'Here are shirts for your daughter!' },
  ], state6);
  console.log('Updated gender:', res6.updatedState.gender);
  console.log('Action:', res6.action);
  if (res6.updatedState.gender === 'boys') {
    console.log('✅ Test 6 Passed: Corrected gender to boys\n');
    passedCount++;
  } else {
    console.log('❌ Test 6 Failed\n');
  }

  // Test Case 7: "I don't care about the color" -> color becomes not-important
  console.log('--- Test 7: "I don\'t care about the color" ---');
  let state7 = createInitialShoppingState();
  const res7 = await decideProductConversation(model, "I don't care about the color", [], state7);
  console.log('Unimportant fields:', res7.updatedState.unimportantFields);
  if (res7.updatedState.unimportantFields.includes('color')) {
    console.log('✅ Test 7 Passed: Color marked as unimportant\n');
    passedCount++;
  } else {
    console.log('❌ Test 7 Failed\n');
  }

  // Test Case 8: Multi-field answer -> no redundant questions
  console.log('--- Test 8: Multi-field answer ("A party shirt for my 5 year old boy") ---');
  let state8 = createInitialShoppingState();
  const res8 = await decideProductConversation(model, 'A party shirt for my 5 year old boy', [], state8);
  console.log('Action:', res8.action);
  console.log('CanSearch:', res8.canSearch);
  console.log('Type:', res8.updatedState.type);
  console.log('Gender:', res8.updatedState.gender);
  console.log('Age:', res8.updatedState.ageMin);
  console.log('Occasion:', res8.updatedState.occasion);
  console.log('Missing fields:', res8.missingFields);
  if (res8.action === 'search' && res8.missingFields.length === 0 && res8.updatedState.type === 'shirt' && res8.updatedState.gender === 'boys' && res8.updatedState.ageMin === 5) {
    console.log('✅ Test 8 Passed: All mandatory fields extracted, zero redundant questions, search triggered\n');
    passedCount++;
  } else {
    console.log('❌ Test 8 Failed\n');
  }

  console.log('====================================================');
  console.log(`TEST RESULTS: ${passedCount}/${totalCount} PASSED`);
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
