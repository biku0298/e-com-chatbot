import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pg from 'pg';
import 'dotenv/config';

export const maxDuration = 60;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Raw pg pool — needed for vector similarity queries (Prisma can't handle
// Unsupported vector columns in WHERE/ORDER BY clauses)
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL!,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  connectionTimeoutMillis: 30000,
});

// ─── types ────────────────────────────────────────────────────────────────────

type HistoryMessage = {
  sender: 'user' | 'bot';
  text: string;
};

type Filters = {
  category?: string | null;
  type?: string | null;
  gender?: string | null;
  maxPrice?: number | null;
  ageMin?: number | null;
  ageMax?: number | null;
  occasion?: string | null;
  color?: string | null;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Coerces all numeric fields in the raw Gemini JSON to actual JS numbers.
 * Gemini sometimes returns numbers as strings (e.g. "500" instead of 500).
 * This runs immediately after JSON.parse so the rest of the code can trust types.
 */
function sanitizeFilters(raw: Record<string, any>): Filters {
  const toIntOrNull  = (v: any): number | null => { const n = parseInt(v,  10); return isNaN(n) ? null : n; };
  const toFloatOrNull = (v: any): number | null => { const n = parseFloat(v);   return isNaN(n) ? null : n; };
  return {
    category: raw.category  ?? null,
    type:     raw.type      ?? null,
    gender:   raw.gender    ?? null,
    occasion: raw.occasion  ?? null,
    color:    raw.color     ?? null,
    maxPrice: raw.maxPrice  != null ? toFloatOrNull(raw.maxPrice) : null,
    ageMin:   raw.ageMin    != null ? toIntOrNull(raw.ageMin)    : null,
    ageMax:   raw.ageMax    != null ? toIntOrNull(raw.ageMax)    : null,
  };
}

async function generateWithRetry(model: any, prompt: string, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error: any) {
      const isOverloaded = error?.status === 503;
      const isLastAttempt = attempt === retries;
      if (isOverloaded && !isLastAttempt) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}

/** Format the last few messages as a readable transcript for Gemini */
function formatHistory(history: HistoryMessage[]): string {
  if (!history || history.length === 0) return '';
  return (
    '\n\nConversation so far:\n' +
    history.map((m) => `${m.sender === 'user' ? 'Customer' : 'Ray'}: ${m.text}`).join('\n')
  );
}

// ─── Call 1: extract structured filters ───────────────────────────────────────

async function extractFilters(model: any, message: string, history: HistoryMessage[]): Promise<Filters> {
  const historyBlock = formatHistory(history);

  const prompt = `
Extract shopping filters from this customer message for a kids' clothing store.
Return ONLY valid JSON, no explanation, no markdown formatting.

Fields (use null if not mentioned):
- category: "topwear" or "bottomwear" or null (broad category if user says "topwear", "tops", "bottomwear", "bottoms")
- type: "shirt" or "shorts" or "jeans" or "top" or "skirt" or "dress" or null (specific garment type if mentioned)
- gender: "boys" or "girls" or null
- maxPrice: number or null
- ageMin: integer (youngest age in years) or null — e.g. if customer says "5 year old" return 5; "3-6 years" return 3; "toddler" return 1
- ageMax: integer (oldest age in years) or null — e.g. if customer says "5 year old" return 5; "3-6 years" return 6; "toddler" return 3
- occasion: "casual" or "party" or "ethnic" or null — ONLY if explicitly mentioned (e.g. party, birthday, festive, ethnic, wedding, casual). Do NOT guess; use null if not mentioned.
- color: the exact color word mentioned (e.g. "red", "blue", "green", "yellow", "black", "white", "pink", "grey") or null if not mentioned

IMPORTANT: The customer may be referring to previous messages (e.g. "cheaper ones",
"show in blue", "for girls instead", "show party wear"). Use the conversation history to fill in any
filters that were mentioned earlier and not explicitly repeated.
${historyBlock}

Latest customer message: "${message}"

JSON:`;

  const raw = await generateWithRetry(model, prompt);
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    return sanitizeFilters(JSON.parse(cleaned));
  } catch {
    return {};
  }
}

// ─── Embed the user's query for vector search ─────────────────────────────────

async function embedQuery(text: string): Promise<number[]> {
  const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
  const result = await embeddingModel.embedContent({
    content: { parts: [{ text }], role: 'user' },
    outputDimensionality: 768,
  } as any);
  return result.embedding.values;
}

// ─── Hybrid product search: structured filters + vector similarity ─────────────

async function searchProducts(
  filters: Filters,
  queryVector: number[],
  skip = 0,
  take = 6
): Promise<any[]> {
  const conditions: string[] = ['embedding IS NOT NULL'];
  const params: any[] = [];
  let paramIdx = 1;

  if (filters.type) {
    conditions.push(`type = $${paramIdx++}`);
    params.push(filters.type);
  } else if (filters.category) {
    conditions.push(`category = $${paramIdx++}`);
    params.push(filters.category);
  }
  if (filters.gender) {
    conditions.push(`gender = $${paramIdx++}`);
    params.push(filters.gender);
  }
  if (filters.maxPrice != null) {
    conditions.push(`price <= $${paramIdx++}`);
    params.push(filters.maxPrice);
  }
  if (filters.ageMin != null) {
    conditions.push(`"maxAge" >= $${paramIdx++}`);
    params.push(filters.ageMin);
  }
  if (filters.ageMax != null) {
    conditions.push(`"minAge" <= $${paramIdx++}`);
    params.push(filters.ageMax);
  }
  if (filters.occasion) {
    conditions.push(`occasion = $${paramIdx++}`);
    params.push(filters.occasion);
  }
  if (filters.color) {
    conditions.push(`color = $${paramIdx++}`);
    params.push(filters.color);
  }

  const vectorStr = `[${queryVector.join(',')}]`;
  const whereClause = conditions.join(' AND ');

  const query = `
    SELECT id, name, price, "imageUrl", color, size, gender, type, occasion
    FROM "Product"
    WHERE ${whereClause}
    ORDER BY embedding <=> $${paramIdx}::vector
    LIMIT $${paramIdx + 1}
    OFFSET $${paramIdx + 2}
  `;
  params.push(vectorStr, take, skip);

  const result = await pool.query(query, params);
  return result.rows;
}

// ─── Policy chunk search ──────────────────────────────────────────────────────

async function searchPolicyChunks(
  queryVector: number[],
  topK = 5
): Promise<{ heading: string | null; content: string }[]> {
  const vectorStr = `[${queryVector.join(',')}]`;
  const result = await pool.query(
    `SELECT heading, content
     FROM "PolicyChunk"
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vectorStr, topK]
  );
  return result.rows;
}

// ─── Policy RAG answer ────────────────────────────────────────────────────────

async function generatePolicyAnswer(
  model: any,
  message: string,
  chunks: { heading: string | null; content: string }[],
  history: HistoryMessage[]
): Promise<string> {
  const historyBlock = formatHistory(history);
  const context = chunks
    .map((c) => (c.heading ? `[${c.heading}]\n${c.content}` : c.content))
    .join('\n\n');

  const prompt = `
You are Ray, a friendly assistant for Bachpankart, a kids' products store.
${historyBlock}

A customer asked: "${message}"

Answer ONLY using the policy information below. Do not make anything up.
If the answer is not covered by the context, say so politely.
Keep the answer short, clear, and friendly — 2–4 sentences max.

Policy context:
${context}

Answer:`;

  const raw = await generateWithRetry(model, prompt);
  return raw.trim();
}

// ─── Policy follow-up suggestion ─────────────────────────────────────────────

/**
 * Generates ONE short follow-up question a customer might naturally ask
 * after receiving a policy answer (e.g. "How do I track my order?").
 */
async function generatePolicySuggestion(
  model: any,
  policyAnswer: string
): Promise<string> {
  const prompt = `
A customer just received this policy answer from a kids' store chatbot:
"${policyAnswer}"

Write ONE short follow-up question the customer might naturally ask next.
Examples: "How do I track my order?", "Can I exchange for a different size?", "How long does delivery take?"
Return ONLY the question, no explanation, no punctuation at the end.
Question:`;
  const raw = await generateWithRetry(model, prompt);
  return raw.trim().replace(/[?.!]+$/, '').trim() + '?';
}

async function generateReply(
  model: any,
  message: string,
  productList: string,
  history: HistoryMessage[]
) {
  const historyBlock = formatHistory(history);

  const prompt = `
You are Ray, a friendly shopping assistant for Bachpankart, a kids' products store.
${historyBlock}

The customer just asked: "${message}"

Catalog context (DO NOT repeat this in your reply — it will be shown as product cards):
${productList}

Respond with ONLY a JSON object (no markdown, no extra text) in this exact shape:
{
  "reply": "<one short friendly sentence>",
  "suggestions": ["<follow-up chip 1>", "<follow-up chip 2>", "<follow-up chip 3>"]
}

Rules for "reply":
- EXACTLY one sentence — no more
- Do NOT list or mention individual product names, colors, sizes, or prices
  (those are already shown in the product cards below your reply)
- If products were found: write a warm one-liner introducing the results
  e.g. "Here are some shirts for boys under ₹500 👕" or "Found a few great options — take a look!"
- If no products found: one short, clear sentence asking them to try different criteria
  e.g. "Couldn't find a match — want to try a different price range or category?"
- No links, no markdown, no emoji overload (one emoji max)

Rules for "suggestions":
- Exactly ONE short, tappable follow-up a customer might naturally ask next
- Make it specific to what was just shown (category, gender, occasion)
- NEVER suggest price-related follow-ups (no "under ₹X", "cheaper", "budget") — price chips are handled separately
- NEVER suggest "show more", "more options", "more styles", or any pagination phrasing — that button already exists
- If no products were found, suggest a broader search e.g. "Show all girls tops"
- Return it as an array with exactly one string: ["your suggestion"]

JSON:`;

  const raw = await generateWithRetry(model, prompt);
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      reply: parsed.reply ?? cleaned,
      suggestions: parsed.suggestions ?? [],
    };
  } catch {
    return { reply: cleaned, suggestions: [] };
  }
}

// ─── Size reference table ────────────────────────────────────────────────────
// Static reference used as context for Gemini sizing answers.
// Format: { label, ageMin, ageMax, heightCmMin, heightCmMax }
const SIZE_REFERENCE = `
Kids Clothing Size Guide (Bachpankart):

| Size Label | Age Range    | Approx. Height |
|------------|--------------|----------------|
| 0-6M       | 0-6 months   | up to 67 cm    |
| 6-12M      | 6-12 months  | 67-76 cm       |
| 1-2Y       | 1-2 years    | 76-92 cm       |
| 2-3Y       | 2-3 years    | 92-98 cm       |
| 3-4Y       | 3-4 years    | 98-104 cm      |
| 4-5Y       | 4-5 years    | 104-110 cm     |
| 5-6Y       | 5-6 years    | 110-116 cm     |
| 6-7Y       | 6-7 years    | 116-122 cm     |
| 7-8Y       | 7-8 years    | 122-128 cm     |
| 8-9Y       | 8-9 years    | 128-134 cm     |
| 10-11Y     | 10-11 years  | 134-140 cm     |
| 11-12Y     | 11-12 years  | 140-146 cm     |
| 12-13Y     | 12-13 years  | 146-152 cm     |

Notes:
- When in doubt between two sizes, recommend the larger one for growing room.
- For bottomwear, waist can be a deciding factor — most kids sizes have adjustable waists.
- Preemie/newborn sizes exist but are not in our current catalog.
`;

// ─── Sizing flow handler ──────────────────────────────────────────────────────

/**
 * Handles the sizing-help intent.
 * Returns one of two shapes:
 *   { action: 'ask',       reply: string }                          — need more info
 *   { action: 'recommend', reply: string, ageMin, ageMax, gender }  — ready to search
 */
async function handleSizingFlow(
  model: any,
  message: string,
  history: HistoryMessage[]
): Promise<
  | { action: 'ask'; reply: string }
  | { action: 'recommend'; reply: string; ageMin: number; ageMax: number; gender: string | null }
> {
  const historyBlock = formatHistory(history);

  const prompt = `
You are Ray, a friendly sizing assistant for Bachpankart, a kids' clothing store.
${historyBlock}

Customer message: "${message}"

Your job: determine whether you have ENOUGH information (age OR height) to recommend a size.
Use the conversation history — if the customer already gave age or height earlier, use it.

Size reference:
${SIZE_REFERENCE}

Respond with ONLY valid JSON — no markdown, no explanation.

If you do NOT have enough info yet:
{
  "action": "ask",
  "reply": "<one warm, short clarifying question asking for age or height>"
}

If you DO have enough info:
{
  "action": "recommend",
  "reply": "<one friendly sentence naming the recommended size label and transitioning to product results>",
  "ageMin": <integer — minimum age for this size, e.g. 4>,
  "ageMax": <integer — maximum age for this size, e.g. 6>,
  "gender": "<boys or girls if mentioned in conversation, else null>"
}

Rules for reply (recommend):
- Name the size label e.g. "4-5Y"
- End with something like "Let me show you some options!" or "Here's what fits!"
- One sentence only

JSON:`;

  const raw = await generateWithRetry(model, prompt);
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.action === 'recommend') {
      return {
        action: 'recommend',
        reply: parsed.reply ?? 'Here are some great options for that size!',
        ageMin: parsed.ageMin ?? 0,
        ageMax: parsed.ageMax ?? 12,
        gender: parsed.gender ?? null,
      };
    }
    return {
      action: 'ask',
      reply: parsed.reply ?? "What's your child's age, or their height in cm?",
    };
  } catch {
    return {
      action: 'ask',
      reply: "What's your child's age, or their height in cm?",
    };
  }
}

// ─── Smart suggestion picker ─────────────────────────────────────────────────

const CROSS_SELL_CHANCE = 0.35;

/**
 * If the user's current filters point clearly to topwear or bottomwear,
 * returns a complementary "match with X" chip. Returns null if category/type
 * is unknown or ambiguous.
 */
function getCrossSellChip(filters: Filters): string | null {
  const TOPWEAR_TYPES = ['shirt', 'top'];
  const BOTTOMWEAR_TYPES = ['shorts', 'jeans', 'skirt', 'dress'];

  let effectiveCategory: 'topwear' | 'bottomwear' | null = null;

  if (filters.category === 'topwear' || filters.category === 'bottomwear') {
    effectiveCategory = filters.category;
  } else if (filters.type && TOPWEAR_TYPES.includes(filters.type)) {
    effectiveCategory = 'topwear';
  } else if (filters.type && BOTTOMWEAR_TYPES.includes(filters.type)) {
    effectiveCategory = 'bottomwear';
  }

  if (effectiveCategory === 'topwear') {
    return 'Match with bottomwear 👖';
  }
  if (effectiveCategory === 'bottomwear') {
    return 'Match with topwear 👕';
  }
  return null;
}

/**
 * Core gap-filling logic (occasion / price / color) — same decision tree as
 * before, just extracted into its own function so the outer picker can
 * optionally override one slot with a cross-sell suggestion.
 */
function pickSmartSuggestionsCore(filters: Filters): string[] {
  const occasionOpen = !filters.occasion;
  const priceOpen = filters.maxPrice == null;
  const colorOpen = !filters.color;

  const OCCASION_CHIP: Record<string, string> = {
    party: 'Show party wear 🎉',
    ethnic: 'Show ethnic wear 🪷',
    casual: 'Show casual wear 👕',
  };
  const ALL_OCCASIONS = ['party', 'ethnic', 'casual'] as const;
  const PRICE_PHRASES = ['Under ₹500 👛', 'Under ₹700 👛', 'Under ₹1000 👛'];
  const COLOR_PHRASES = ['Show in different colors 🎨', 'Try another color 🌈'];

  function pick(phrases: string[]): string {
    return phrases[Math.floor(Math.random() * phrases.length)];
  }

  function occasionChip(exclude: string | null = null): string {
    const options = ALL_OCCASIONS.filter((o) => o !== exclude);
    return OCCASION_CHIP[options[Math.floor(Math.random() * options.length)]];
  }

  const openCount = [occasionOpen, priceOpen, colorOpen].filter(Boolean).length;

  if (openCount === 3) {
    const useOccasionPair = Math.random() < 0.5;
    if (useOccasionPair) {
      const first = occasionChip();
      const firstKey = ALL_OCCASIONS.find((o) => OCCASION_CHIP[o] === first)!;
      return [first, occasionChip(firstKey)];
    }
    return [occasionChip(), pick(PRICE_PHRASES)];
  }

  if (!occasionOpen && priceOpen && colorOpen) {
    return [pick(PRICE_PHRASES), pick(COLOR_PHRASES)];
  }

  if (occasionOpen && !priceOpen && colorOpen) {
    return [occasionChip(filters.occasion ?? null), pick(COLOR_PHRASES)];
  }

  if (occasionOpen && priceOpen && !colorOpen) {
    return [occasionChip(filters.occasion ?? null), pick(PRICE_PHRASES)];
  }

  if (openCount === 1) {
    if (occasionOpen) {
      return [occasionChip(filters.occasion ?? null), pick(COLOR_PHRASES)];
    }
    if (priceOpen) {
      return [pick(PRICE_PHRASES), pick(COLOR_PHRASES)];
    }
    return [pick(COLOR_PHRASES), pick(PRICE_PHRASES)];
  }

  return [pick(COLOR_PHRASES), pick(PRICE_PHRASES)];
}

/**
 * Returns exactly 2 context-aware follow-up suggestion chips.
 * ~35% of the time, if the current filters clearly indicate topwear or
 * bottomwear, one slot is replaced with a "match with X" cross-sell chip.
 */
function pickSmartSuggestions(filters: Filters): string[] {
  const base = pickSmartSuggestionsCore(filters);

  const crossSellChip = getCrossSellChip(filters);
  if (crossSellChip && Math.random() < CROSS_SELL_CHANCE) {
    const slotToReplace = Math.floor(Math.random() * 2);
    const result = [...base];
    result[slotToReplace] = crossSellChip;
    return result;
  }

  return base;
}

// ─── POST handler ─────────────────────────────────────────────────────────────

// ─── Intent classifier ────────────────────────────────────────────────────────

/**
 * Returns 'product' | 'policy' | 'general' | 'sizing'.
 * Uses keyword heuristics first (instant), Gemini fallback for ambiguous cases.
 */
async function classifyIntent(
  model: any,
  message: string,
  history: HistoryMessage[]
): Promise<'product' | 'policy' | 'general' | 'sizing'> {
  const lower = message.toLowerCase().trim();

  // 1. Policy keywords (store operations: returns, refunds, delivery, etc.)
  const policyKeywords = [
    'return', 'refund', 'exchange', 'cancel', 'policy', 'days',
    'replace', 'warranty', 'damaged', 'wrong item', 'ship', 'shipping',
    'delivery', 'how long', 'when will', 'eligible', 'inspection',
  ];
  if (policyKeywords.some((kw) => lower.includes(kw))) return 'policy';

  // 2. Explicit product keywords (garments, shopping actions, colors, price)
  const productKeywords = [
    'shirt', 'top', 'dress', 'jeans', 'skirt', 'shorts', 't-shirt', 'tshirt',
    'pant', 'pants', 'frock', 'jacket', 'kurta', 'ethnic', 'party wear', 'casual wear',
    'clothes', 'clothing', 'wear', 'outfit', 'apparel', 'buy', 'show', 'show me',
    'find', 'suggest', 'recommend', 'looking for', 'under', 'below', 'cheap', 'affordable',
    'budget', 'price', '₹', 'rs', 'rupees', 'boy', 'boys', 'girl', 'girls', 'kid', 'kids',
    'birthday', 'gift', 'collection', 'red', 'blue', 'green', 'yellow', 'black', 'white',
    'pink', 'grey', 'gray', 'orange', 'purple', 'topwear', 'bottomwear',
  ];
  const hasProductKeywords = productKeywords.some((kw) => lower.includes(kw));

  // 3. Sizing intent — ONLY trigger when explicitly asking about sizes or measurements
  const explicitSizingKeywords = [
    'what size', 'which size', 'what\'s the size', 'right size', 'size guide',
    'size chart', 'sizing guide', 'sizing chart', 'how does sizing', 'how do sizes',
    'size advice', 'size help', 'size for my', 'recommend a size', 'suggest a size',
    'which fit', 'fits best', 'fit guide',
  ];
  if (explicitSizingKeywords.some((kw) => lower.includes(kw))) return 'sizing';

  // Sizing continuation: check if conversation history shows we're waiting for size/age response
  const lastBotMsg = [...history].reverse().find((m) => m.sender === 'bot');
  const isBotWaitingForSize =
    lastBotMsg &&
    (lastBotMsg.text.toLowerCase().includes('age') ||
      lastBotMsg.text.toLowerCase().includes('height') ||
      lastBotMsg.text.toLowerCase().includes('cm') ||
      lastBotMsg.text.toLowerCase().includes('size'));
  if (isBotWaitingForSize && /\d/.test(message) && !hasProductKeywords) {
    return 'sizing';
  }

  // 4. If product keywords are present, classify as product (shopping takes priority over greetings)
  if (hasProductKeywords) return 'product';

  // 5. Greeting / small talk — ONLY if not asking about products or policies
  const greetingKeywords = [
    'hi', 'hello', 'hey', 'hii', 'helo', 'howdy', 'namaste',
    'good morning', 'good evening', 'good afternoon',
    'how are you', 'what can you do', 'who are you', 'what are you',
    'help', 'thanks', 'thank you', 'bye', 'ok', 'okay', 'cool',
  ];
  if (greetingKeywords.some((kw) => lower === kw || lower.startsWith(kw + ' ') || lower.endsWith(' ' + kw))) {
    return 'general';
  }

  // 6. Fallback: ask Gemini for ambiguous cases
  const historyBlock = formatHistory(history);
  const prompt = `
You are classifying a customer message for a kids' clothing store chatbot.
Return ONLY one word: "product", "policy", "general", or "sizing".
- "product" = shopping, browsing, finding clothes, recommendations, gifts
- "policy" = returns, refunds, exchanges, shipping, delivery, cancellation
- "general" = greetings, small talk, questions about the chatbot itself
- "sizing" = finding the right size, age-to-size help, height-based sizing
${historyBlock}
Message: "${message}"
Answer:`;

  try {
    const raw = await generateWithRetry(model, prompt);
    const word = raw.trim().toLowerCase();
    if (word.startsWith('policy')) return 'policy';
    if (word.startsWith('general')) return 'general';
    if (word.startsWith('sizing')) return 'sizing';
    return 'product';
  } catch {
    return 'product';
  }
}

// ─── General conversational reply (greetings / small talk) ─────────────────────

async function generateGeneralReply(
  model: any,
  message: string,
  history: HistoryMessage[]
): Promise<string> {
  const historyBlock = formatHistory(history);
  const prompt = `
You are Ray, a friendly shopping assistant for Bachpankart, a kids' products store.
${historyBlock}
Customer said: "${message}"
Reply in ONE short, warm, friendly sentence. Do NOT mention products or policies unless directly asked.
Answer:`;
  const raw = await generateWithRetry(model, prompt);
  return raw.trim();
}


export async function POST(request: NextRequest) {
  const { message, history = [] } = await request.json();

  if (!message || typeof message !== 'string') {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  }

  // Keep only last 6 messages to limit prompt size
  const recentHistory: HistoryMessage[] = (history as HistoryMessage[]).slice(-6);

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' });

    // Step 1: classify intent first (keyword heuristic is instant for most messages)
    const intent = await classifyIntent(model, message, recentHistory);

    // ── General branch (greetings / small talk) ────────────────────────────
    // No embedding, no DB query — just a quick conversational reply
    if (intent === 'general') {
      const generalReply = await generateGeneralReply(model, message, recentHistory);
      return NextResponse.json({
        reply: generalReply,
        products: [],
        suggestions: ['Show tops for boys', 'Dresses for girls', 'Gifts under ₹500'],
        filters: {},
      });
    }

    // ── Sizing branch ─────────────────────────────────────────────────────────
    if (intent === 'sizing') {
      const sizingResult = await handleSizingFlow(model, message, recentHistory);

      if (sizingResult.action === 'ask') {
        // Still gathering info — return just the clarifying question, no products
        return NextResponse.json({
          reply: sizingResult.reply,
          products: [],
          isSizing: true,
          suggestions: [],
          filters: {},
        });
      }

      // action === 'recommend' — run product search with the determined age range
      // AND extract any shopping filters (color, price, category, occasion) from the conversation
      const [extractedFilters, queryVector] = await Promise.all([
        extractFilters(model, message, recentHistory),
        embedQuery(message),
      ]);

      const sizeFilters: Filters = {
        ...extractedFilters,
        ageMin: sizingResult.ageMin ?? extractedFilters.ageMin ?? null,
        ageMax: sizingResult.ageMax ?? extractedFilters.ageMax ?? null,
        gender: (sizingResult.gender as string | null) ?? extractedFilters.gender ?? null,
      };

      const products = await searchProducts(sizeFilters, queryVector);
      const productList = products.length
        ? products.map((p) => `- ${p.name} (${p.color}, ${p.size}) — ₹${p.price}`).join('\n')
        : 'No matching products found in the catalog.';

      const suggestions = pickSmartSuggestions(sizeFilters);

      return NextResponse.json({
        reply: sizingResult.reply,
        products,
        isSizing: false, // has products — use product chip set
        suggestions,
        filters: sizeFilters,
      });
    }

    // For product + policy: embed the query (needed for both vector searches)
    const [filters, queryVector] = await Promise.all([
      extractFilters(model, message, recentHistory),
      embedQuery(message),
    ]);

    // ── Policy branch ────────────────────────────────────────────────────────
    if (intent === 'policy') {
      const policyChunks = await searchPolicyChunks(queryVector);
      const policyAnswer = await generatePolicyAnswer(model, message, policyChunks, recentHistory);
      // Generate one context-aware follow-up suggestion in parallel (non-blocking on answer)
      const policySuggestion = await generatePolicySuggestion(model, policyAnswer);
      return NextResponse.json({
        reply: policyAnswer,
        products: [],
        isPolicy: true,
        suggestions: [policySuggestion],
        filters: {},
      });
    }

    // ── Product branch ───────────────────────────────────────────────────────

    // Step 2: hybrid search — structured filters + vector similarity ranking
    const products = await searchProducts(filters, queryVector);

    // Step 3: ask Gemini to write the reply text
    const productList = products.length
      ? products.map((p) => `- ${p.name} (${p.color}, ${p.size}) — ₹${p.price}`).join('\n')
      : 'No matching products found in the catalog.';

    const { reply } = await generateReply(model, message, productList, recentHistory);

    // Always exactly 2 smart chips — combined with 2 fixed frontend chips = 4 total always.
    const suggestions = pickSmartSuggestions(filters);

    return NextResponse.json({ reply, products, suggestions, filters });
  } catch (error) {
    console.error('Ray error:', error);
    return NextResponse.json(
      { error: 'Ray is a bit busy right now — please try again in a moment.' },
      { status: 500 }
    );
  }
}
