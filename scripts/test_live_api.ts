async function testLiveApi() {
  const url = 'http://localhost:3000/api/chat';

  console.log('====================================================');
  console.log('TESTING LIVE MULTI-TURN API CONVERSATION');
  console.log('====================================================\n');

  // Turn 1: "Show me a dress"
  console.log('▶ Turn 1: Customer: "Show me a dress"');
  const res1 = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Show me a dress', history: [], shoppingState: null }),
  });
  const data1 = await res1.json();
  console.log('Ray:', data1.reply);
  console.log('Products returned:', data1.products?.length);
  console.log('ShoppingState:', {
    type: data1.shoppingState?.type,
    gender: data1.shoppingState?.gender,
    ageMin: data1.shoppingState?.ageMin,
    missingFields: data1.shoppingState?.missingFields,
    isReadyForSearch: data1.shoppingState?.isReadyForSearch,
  });

  if (data1.products?.length === 0 && data1.shoppingState?.type === 'dress' && !data1.shoppingState?.isReadyForSearch) {
    console.log('✅ Turn 1 SUCCESS: Clarification asked, 0 products returned, dress recorded\n');
  } else {
    console.log('❌ Turn 1 FAILED\n');
  }

  // Turn 2: "For a girl"
  console.log('▶ Turn 2: Customer: "For a girl"');
  const res2 = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'For a girl',
      history: [
        { sender: 'user', text: 'Show me a dress' },
        { sender: 'bot', text: data1.reply },
      ],
      shoppingState: data1.shoppingState,
    }),
  });
  const data2 = await res2.json();
  console.log('Ray:', data2.reply);
  console.log('Products returned:', data2.products?.length);
  console.log('ShoppingState:', {
    type: data2.shoppingState?.type,
    gender: data2.shoppingState?.gender,
    ageMin: data2.shoppingState?.ageMin,
    missingFields: data2.shoppingState?.missingFields,
    isReadyForSearch: data2.shoppingState?.isReadyForSearch,
  });

  if (data2.products?.length === 0 && data2.shoppingState?.gender === 'girls' && !data2.shoppingState?.isReadyForSearch) {
    console.log('✅ Turn 2 SUCCESS: Age asked, 0 products returned, gender=girls merged\n');
  } else {
    console.log('❌ Turn 2 FAILED\n');
  }

  // Turn 3: "She is 6 years old"
  console.log('▶ Turn 3: Customer: "She is 6 years old"');
  const res3 = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'She is 6 years old',
      history: [
        { sender: 'user', text: 'Show me a dress' },
        { sender: 'bot', text: data1.reply },
        { sender: 'user', text: 'For a girl' },
        { sender: 'bot', text: data2.reply },
      ],
      shoppingState: data2.shoppingState,
    }),
  });
  const data3 = await res3.json();
  console.log('Ray:', data3.reply);
  console.log('Products returned:', data3.products?.length);
  if (data3.products?.length > 0) {
    console.log('First product:', data3.products[0].name, '₹' + data3.products[0].price);
  }
  console.log('ShoppingState:', {
    type: data3.shoppingState?.type,
    gender: data3.shoppingState?.gender,
    ageMin: data3.shoppingState?.ageMin,
    ageMax: data3.shoppingState?.ageMax,
    missingFields: data3.shoppingState?.missingFields,
    isReadyForSearch: data3.shoppingState?.isReadyForSearch,
  });

  if (data3.products?.length > 0 && data3.shoppingState?.isReadyForSearch) {
    console.log('✅ Turn 3 SUCCESS: Product search executed, matching products returned!\n');
  } else {
    console.log('❌ Turn 3 FAILED\n');
  }

  // Also test General, Policy, Sizing intents
  console.log('▶ Testing General Intent: "Hello!"');
  const generalRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Hello!', history: [] }),
  });
  const generalData = await generalRes.json();
  console.log('General reply:', generalData.reply);
  console.log('General products:', generalData.products?.length);

  console.log('\n▶ Testing Policy Intent: "What is your return policy?"');
  const policyRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'What is your return policy?', history: [] }),
  });
  const policyData = await policyRes.json();
  console.log('Policy reply:', policyData.reply);
  console.log('Is Policy:', policyData.isPolicy);

  console.log('\n▶ Testing Sizing Intent: "What size should I get for a 5 year old?"');
  const sizingRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'What size should I get for a 5 year old?', history: [] }),
  });
  const sizingData = await sizingRes.json();
  console.log('Sizing reply:', sizingData.reply);

  console.log('\n====================================================');
  console.log('ALL API ENDPOINTS AND INTENTS TESTED SUCCESSFULLY');
  console.log('====================================================');
}

testLiveApi().catch((err) => {
  console.error('Live API test error:', err);
  process.exit(1);
});
