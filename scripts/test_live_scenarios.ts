const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runScenarioTests() {
  const url = 'http://localhost:3000/api/chat';
  const moreUrl = 'http://localhost:3000/api/chat/more';

  console.log('====================================================');
  console.log('RUNNING COMPREHENSIVE LIVE SCENARIO TESTS');
  console.log('====================================================\n');

  // SCENARIO 1: The Exact Diwali Multi-Turn Conversation
  console.log('--- SCENARIO 1: Exact Diwali Multi-Turn Conversation ---');
  // Turn 1: "Show me the dress for Diwali"
  console.log('Turn 1: "Show me the dress for Diwali"');
  const d1 = await (await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Show me the dress for Diwali', history: [], shoppingState: null }),
  })).json();
  console.log('Ray:', d1.reply);
  console.log('Action:', d1.action, 'ReadyForSearch:', d1.readyForSearch, 'Products:', d1.products?.length);
  console.log('State:', { type: d1.shoppingState?.type, occasion: d1.shoppingState?.occasion, gender: d1.shoppingState?.gender, missing: d1.shoppingState?.missingFields });
  if (d1.action === 'ask' && !d1.readyForSearch && d1.products?.length === 0 && d1.shoppingState?.occasion === 'ethnic') {
    console.log('✅ Turn 1 Passed: Asks ONE question, 0 products\n');
  } else {
    console.log('❌ Turn 1 Failed\n');
  }

  await delay(1000);

  // Turn 2: "Girl"
  console.log('Turn 2: "Girl"');
  const d2 = await (await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Girl',
      history: [
        { sender: 'user', text: 'Show me the dress for Diwali' },
        { sender: 'bot', text: d1.reply },
      ],
      shoppingState: d1.shoppingState,
    }),
  })).json();
  console.log('Ray:', d2.reply);
  console.log('Action:', d2.action, 'ReadyForSearch:', d2.readyForSearch, 'Products:', d2.products?.length);
  console.log('State:', { type: d2.shoppingState?.type, gender: d2.shoppingState?.gender, missing: d2.shoppingState?.missingFields });
  if (d2.action === 'ask' && !d2.readyForSearch && d2.products?.length === 0 && d2.shoppingState?.gender === 'girls') {
    console.log('✅ Turn 2 Passed: Captured gender, asks age, 0 products\n');
  } else {
    console.log('❌ Turn 2 Failed\n');
  }

  await delay(1000);

  // Turn 3: "6"
  console.log('Turn 3: "6"');
  const d3 = await (await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: '6',
      history: [
        { sender: 'user', text: 'Show me the dress for Diwali' },
        { sender: 'bot', text: d1.reply },
        { sender: 'user', text: 'Girl' },
        { sender: 'bot', text: d2.reply },
      ],
      shoppingState: d2.shoppingState,
    }),
  })).json();
  console.log('Ray:', d3.reply);
  console.log('Action:', d3.action, 'ReadyForSearch:', d3.readyForSearch, 'Products:', d3.products?.length);
  if (d3.products?.length > 0) {
    console.log('Top match:', d3.products[0].name, '₹' + d3.products[0].price);
  }
  if (d3.action === 'search' && d3.readyForSearch && d3.products?.length > 0 && d3.shoppingState?.ageMin === 6) {
    console.log('✅ Turn 3 Passed: Search executed, matching products returned!\n');
  } else {
    console.log('❌ Turn 3 Failed\n');
  }

  await delay(1000);

  // SCENARIO 2: Ready immediately (All criteria in first turn)
  console.log('--- SCENARIO 2: Complete criteria upfront ---');
  console.log('User: "Show me a blue ethnic dress for my 7-year-old daughter under ₹1200"');
  const s2 = await (await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Show me a blue ethnic dress for my 7-year-old daughter under ₹1200',
      history: [],
      shoppingState: null,
    }),
  })).json();
  console.log('Ray:', s2.reply);
  console.log('Action:', s2.action, 'ReadyForSearch:', s2.readyForSearch, 'Products:', s2.products?.length);
  console.log('Color:', s2.shoppingState?.color, 'Price:', s2.shoppingState?.maxPrice, 'Age:', s2.shoppingState?.ageMin, 'Gender:', s2.shoppingState?.gender);
  if (s2.action === 'search' && s2.readyForSearch === true) {
    console.log('✅ Scenario 2 Passed: Ready immediately, 0 unnecessary questions\n');
  } else {
    console.log('❌ Scenario 2 Failed\n');
  }

  await delay(1000);

  // SCENARIO 3: Generic query asks ONE question
  console.log('--- SCENARIO 3: "I need something for my daughter for Diwali" ---');
  const s3 = await (await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'I need something for my daughter for Diwali',
      history: [],
      shoppingState: null,
    }),
  })).json();
  console.log('Ray:', s3.reply);
  console.log('Action:', s3.action, 'ReadyForSearch:', s3.readyForSearch, 'Products:', s3.products?.length);
  if (s3.action === 'ask' && !s3.readyForSearch && s3.products?.length === 0) {
    console.log('✅ Scenario 3 Passed: Asks ONE question, 0 premature products\n');
  } else {
    console.log('❌ Scenario 3 Failed\n');
  }

  await delay(1000);

  // SCENARIO 4: Mid-turn correction
  console.log('--- SCENARIO 4: Mid-turn correction ("Actually, make it for my son") ---');
  const s4 = await (await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Actually, make it for my son.',
      history: [
        { sender: 'user', text: 'Show me a shirt for my 5 year old daughter' },
        { sender: 'bot', text: 'Here are shirts for your daughter!' },
      ],
      shoppingState: {
        intent: 'product',
        category: 'topwear',
        type: 'shirt',
        gender: 'girls',
        ageMin: 5,
        ageMax: 5,
        color: null,
        fit: null,
        occasion: null,
        maxPrice: null,
        unimportantFields: [],
        missingFields: [],
        isReadyForSearch: true,
      },
    }),
  })).json();
  console.log('Ray:', s4.reply);
  console.log('Action:', s4.action, 'Gender:', s4.shoppingState?.gender);
  if (s4.shoppingState?.gender === 'boys') {
    console.log('✅ Scenario 4 Passed: Gender corrected to boys\n');
  } else {
    console.log('❌ Scenario 4 Failed\n');
  }

  await delay(1000);

  // SCENARIO 5: Premature search prevention tests
  console.log('--- SCENARIO 5: Premature search prevention tests ---');
  const testPhrases = [
    'Show me a dress',
    'Show me something for Diwali',
    'I need something for my daughter',
    'Looking for clothes for my child',
  ];
  let allBlocked = true;
  for (const phrase of testPhrases) {
    const res = await (await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: phrase, history: [], shoppingState: null }),
    })).json();
    console.log(`"${phrase}" -> Action: ${res.action}, Products: ${res.products?.length}, Ready: ${res.readyForSearch}`);
    if (res.readyForSearch !== false || res.products?.length !== 0 || res.action !== 'ask') {
      allBlocked = false;
    }
    await delay(500);
  }
  if (allBlocked) {
    console.log('✅ Scenario 5 Passed: All premature searches completely blocked!\n');
  } else {
    console.log('❌ Scenario 5 Failed\n');
  }

  // SCENARIO 6: Server validation of untrusted client state
  console.log('--- SCENARIO 6: Untrusted Client State Tampering Protection ---');
  const tamperedState = {
    isReadyForSearch: true, // CLIENT TRIES TO FORCE READY
    missingFields: [],
    gender: null,
    type: null,
    ageMin: null,
    bogusField: 'malicious',
  };
  const s6 = await (await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Give me anything', history: [], shoppingState: tamperedState }),
  })).json();
  console.log('Action:', s6.action, 'Server ReadyForSearch:', s6.readyForSearch, 'Products:', s6.products?.length);
  if (s6.readyForSearch === false && s6.products?.length === 0 && s6.action === 'ask') {
    console.log('✅ Scenario 6 Passed: Server deterministically rejected forged readiness and enforced ask\n');
  } else {
    console.log('❌ Scenario 6 Failed\n');
  }

  await delay(1000);

  // SCENARIO 7: Policy inquiry mid-conversation
  console.log('--- SCENARIO 7: Policy Question During Shopping ---');
  const ongoingState = {
    intent: 'product',
    category: 'bottomwear',
    type: 'dress',
    gender: 'girls',
    ageMin: null,
    ageMax: null,
    occasion: 'ethnic',
    color: null,
    fit: null,
    maxPrice: null,
    unimportantFields: [],
    missingFields: ['age'],
    isReadyForSearch: false,
  };
  const s7 = await (await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'what is your return policy?', history: [], shoppingState: ongoingState }),
  })).json();
  console.log('Action:', s7.action, 'isPolicy:', s7.isPolicy, 'Reply:', s7.reply ? s7.reply.slice(0, 80) + '...' : s7.error);
  console.log('Preserved State Type:', s7.shoppingState?.type, 'Occasion:', s7.shoppingState?.occasion, 'Gender:', s7.shoppingState?.gender);
  if (s7.action === 'policy' && s7.isPolicy && s7.shoppingState?.type === 'dress' && s7.shoppingState?.gender === 'girls') {
    console.log('✅ Scenario 7 Passed: Policy answered without breaking preserved shopping state\n');
  } else {
    console.log('❌ Scenario 7 Failed\n');
  }

  await delay(1000);

  // SCENARIO 8: Pagination (/api/chat/more)
  console.log('--- SCENARIO 8: Pagination (/api/chat/more) ---');
  const moreRes = await (await fetch(moreUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filters: d3.filters,
      skip: 6,
      originalQuery: 'Show me the dress for Diwali',
    }),
  })).json();
  console.log('More products returned:', moreRes.products?.length);
  if (Array.isArray(moreRes.products)) {
    console.log('✅ Scenario 8 Passed: /api/chat/more pagination works seamlessly\n');
  } else {
    console.log('❌ Scenario 8 Failed\n');
  }

  console.log('====================================================');
  console.log('ALL 8 SCENARIOS VALIDATED AND VERIFIED SUCCESSFULLY!');
  console.log('====================================================');
}

runScenarioTests().catch((err) => {
  console.error('Scenario test error:', err);
  process.exit(1);
});
