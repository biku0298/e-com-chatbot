import { generateWithRetry } from '@/lib/ai/gemini';
import { STORE_CONFIG } from '@/lib/config';
import { HistoryMessage, ProductSearchResult, ShoppingState, SuggestionContext } from './types';
import { formatHistory } from './history';

export type { SuggestionContext };

/**
 * Regex patterns for banned suggestions (pagination, system resets, filler phrases).
 */
const BANNED_SUGGESTION_REGEX = /\b(show\s+more|more\s+products?|more\s+options?|more\s+styles?|view\s+more|see\s+more|next\s+6|show\s+similar|similar\s+products|start\s+over|reset|tell\s+me\s+more|what\s+else|browse\s+more)\b/i;

/**
 * Small, deterministic fallback suggestions when Gemini fails or returns empty/invalid suggestions.
 * Grounded in open gaps or natural pivots.
 */
export function getSafeFallbackSuggestions(state?: ShoppingState | null): string[] {
  const fallbacks: string[] = [];

  if (!state?.maxPrice) {
    fallbacks.push('Show under ₹1000');
  } else {
    fallbacks.push('Show budget-friendly options');
  }

  if (!state?.color) {
    fallbacks.push('Show in different colors');
  } else {
    fallbacks.push('Try another color');
  }

  if (!state?.occasion) {
    fallbacks.push('Show party wear');
  } else {
    fallbacks.push(state.occasion === 'ethnic' ? 'Show party wear' : 'Show ethnic styles');
  }

  return fallbacks.slice(0, 3);
}

/**
 * Sanitizes suggestions: removes markdown/quotes, filters out pagination and filler phrases,
 * ensures uniqueness, and supplements with safe fallbacks if fewer than 2 valid chips exist.
 */
export function sanitizeSuggestions(
  rawSuggestions: unknown,
  shoppingState?: ShoppingState | null
): string[] {
  const result: string[] = [];

  if (Array.isArray(rawSuggestions)) {
    for (const item of rawSuggestions) {
      if (typeof item !== 'string') continue;
      const clean = item.trim().replace(/^["']|["']$/g, '');
      if (!clean || clean.length > 50) continue;
      if (BANNED_SUGGESTION_REGEX.test(clean)) continue;
      if (!result.includes(clean)) {
        result.push(clean);
      }
    }
  }

  // Ensure 2-3 suggestions
  if (result.length < 2) {
    const fallbacks = getSafeFallbackSuggestions(shoppingState);
    for (const fb of fallbacks) {
      if (!result.includes(fb)) {
        result.push(fb);
      }
      if (result.length >= 2) break;
    }
  }

  return result.slice(0, 3);
}

function formatShoppingStateBlock(state?: ShoppingState | null): string {
  if (!state) return 'None';
  const clean: Record<string, any> = {};
  if (state.type) clean.type = state.type;
  if (state.category) clean.category = state.category;
  if (state.gender) clean.gender = state.gender;
  if (state.ageMin != null || state.ageMax != null) {
    clean.age = state.ageMin === state.ageMax ? `${state.ageMin} years` : `${state.ageMin}-${state.ageMax} years`;
  }
  if (state.occasion) clean.occasion = state.occasion;
  if (state.color) clean.color = state.color;
  if (state.maxPrice != null) clean.maxPrice = `₹${state.maxPrice}`;
  if (state.fit) clean.fit = state.fit;
  return Object.keys(clean).length > 0 ? JSON.stringify(clean, null, 2) : 'None';
}

function formatSearchContextBlock(context?: SuggestionContext | null): string {
  if (!context) return 'None';
  const parts: string[] = [];
  if (context.filters && Object.keys(context.filters).length > 0) {
    parts.push(`Active Filters: ${JSON.stringify(context.filters)}`);
  }
  if (context.originalQuery) {
    parts.push(`Original Query: "${context.originalQuery}"`);
  }
  if (context.offset != null && context.offset > 0) {
    parts.push(`Pagination Offset: ${context.offset} (customer has viewed previous batches)`);
  }
  return parts.join('\n') || 'None';
}

function formatProductSummaryBlock(products?: ProductSearchResult[], fallbackText?: string): string {
  if (products && products.length > 0) {
    const names = products.slice(0, 4).map((p) => p.name).join(', ');
    const colors = Array.from(new Set(products.map((p) => p.color).filter(Boolean))).join(', ');
    const prices = products.map((p) => p.price).filter((pr) => typeof pr === 'number');
    const minPrice = prices.length ? Math.min(...prices) : null;
    const maxPrice = prices.length ? Math.max(...prices) : null;
    const priceRange = minPrice !== null && maxPrice !== null ? `₹${minPrice} - ₹${maxPrice}` : 'N/A';
    const occasions = Array.from(new Set(products.map((p) => p.occasion).filter(Boolean))).join(', ');
    const types = Array.from(new Set(products.map((p) => p.type).filter(Boolean))).join(', ');

    return `Representative items: ${names}
Types: ${types || 'clothing'}
Colors displayed: ${colors || 'various'}
Occasions: ${occasions || 'various'}
Price range: ${priceRange}`;
  }
  if (fallbackText) {
    return fallbackText;
  }
  return 'No matching products found.';
}

/**
 * Generates Ray's conversational response and 2–3 contextual suggestion chips for search results.
 */
export async function generateReply(
  model: any,
  message: string,
  productListFallback: string,
  history: HistoryMessage[],
  context?: SuggestionContext
): Promise<{ reply: string; suggestions: string[] }> {
  const historyBlock = formatHistory(history);
  const stateBlock = formatShoppingStateBlock(context?.shoppingState);
  const searchBlock = formatSearchContextBlock(context);
  const summaryBlock = formatProductSummaryBlock(context?.products, productListFallback);

  const activeColor = context?.shoppingState?.color ?? context?.filters?.color ?? null;
  const activeOccasion = context?.shoppingState?.occasion ?? context?.filters?.occasion ?? null;
  const activeGender = context?.shoppingState?.gender ?? context?.filters?.gender ?? null;
  const activeType = context?.shoppingState?.type ?? context?.filters?.type ?? null;
  const activeMaxPrice = context?.shoppingState?.maxPrice ?? context?.filters?.maxPrice ?? null;

  const prompt = `
You are ${STORE_CONFIG.assistantName}, a friendly shopping assistant for ${STORE_CONFIG.storeName}, ${STORE_CONFIG.storeDescription}.
You are generating a short reply and follow-up shopping suggestions for the CURRENT customer conversation.

Current ShoppingState (what the customer is looking for):
${stateBlock}

Search Context:
${searchBlock}

Conversation history so far:
${historyBlock}

The customer just said: "${message}"

Currently displayed product batch:
${summaryBlock}

Task:
Respond with ONLY a JSON object (no markdown, no extra text) in this exact shape:
{
  "reply": "<one short friendly sentence>",
  "suggestions": ["<follow-up chip 1>", "<follow-up chip 2>", "<follow-up chip 3>"]
}

Rules for "reply":
- EXACTLY one short friendly sentence — no more.
- Do NOT list or mention individual product names, colors, sizes, or prices (those are shown in the product cards).
- If products were found: write a warm one-liner introducing the results (e.g. "Here are some lovely options for you ✨" or "Found some great picks — take a look!").
- If no products found: one short, polite sentence asking them to try adjusting criteria (e.g. "Couldn't find an exact match — want to try a different price range or color?").
- Maximum one emoji. No links, no markdown.

Rules for "suggestions":
- Generate 2 to 3 short follow-up suggestions (maximum 3, minimum 2).
- Grounded in the CURRENT ShoppingState and ongoing shopping context.
- Remember the customer may have viewed multiple product batches (pagination does NOT reset intent).
- Suggest natural next actions such as adjusting price, trying another color, trying a different occasion/style, or exploring related items within the same category/gender/age.
- DO NOT repeat constraints that are ALREADY active:
  * ${activeColor ? `Active color is "${activeColor}": do NOT suggest "Show ${activeColor} products". Suggest "Try another color" or a specific different color.` : 'Suggest a color option if relevant (e.g. "Show in blue", "Try another color").'}
  * ${activeOccasion ? `Active occasion is "${activeOccasion}": do NOT suggest "Show ${activeOccasion} wear". Suggest an alternative style like "Show party wear" or "Show casual wear".` : 'Suggest an occasion option if relevant (e.g. "Show party wear", "Show ethnic styles").'}
  * ${activeMaxPrice ? `Active budget constraint is under ₹${activeMaxPrice}: do NOT suggest "Show under ₹${activeMaxPrice}". Suggest a lower budget or other dimensions.` : 'Suggest budget options if relevant (e.g. "Show under ₹1000", "Show budget-friendly options").'}
  * If the customer just asked "show cheaper", do NOT suggest "Show cheaper options". Suggest a lower price target or another color/style.
- DO NOT contradict the customer's active type (${activeType ? `"${activeType}"` : 'clothing'}), gender (${activeGender ? `"${activeGender}"` : 'any'}), or age unless offering an intentional pivot.
- NEVER suggest pagination: DO NOT include "Show more", "More products", "Next 6", "View more", "Show similar products", or "More options" (pagination is handled separately).
- NEVER suggest "Start over" or "Reset" (handled separately).
- NEVER use generic filler like "Tell me more", "What else can I help with?", "Browse more products".
- NEVER reveal internal technical terms, database, filters, SQL, RAG, or embeddings.
- Keep suggestions short (2 to 5 words) suitable for UI chips (e.g. "Show under ₹1000", "Try another color", "Try party wear", "Show in pink", "Try a more traditional style").

JSON:`;

  try {
    const raw = await generateWithRetry(model, prompt);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const isNoMatch = summaryBlock.includes('No matching');
    const safeReply = typeof parsed.reply === 'string' && parsed.reply.trim()
      ? parsed.reply.trim()
      : (isNoMatch ? "Couldn't find an exact match — want to try a different category or price range?" : "Here are some great options for you ✨");

    const safeSuggestions = sanitizeSuggestions(parsed.suggestions, context?.shoppingState);

    return {
      reply: safeReply,
      suggestions: safeSuggestions,
    };
  } catch (err) {
    console.warn('Gemini generateReply failed or returned invalid JSON, using safe fallback:', err);
    return {
      reply: summaryBlock.includes('No matching')
        ? "Couldn't find an exact match — want to try a different category or price range?"
        : "Here are some great options for you ✨",
      suggestions: getSafeFallbackSuggestions(context?.shoppingState),
    };
  }
}

/**
 * Lightweight helper to generate contextual follow-up suggestions for pagination (/api/chat/more).
 * Omits conversational reply generation to reduce latency and token usage.
 */
export async function generateContextualSuggestions(
  model: any,
  history: HistoryMessage[],
  context: SuggestionContext
): Promise<string[]> {
  const historyBlock = formatHistory(history);
  const stateBlock = formatShoppingStateBlock(context.shoppingState);
  const searchBlock = formatSearchContextBlock(context);
  const summaryBlock = formatProductSummaryBlock(context.products);

  const activeColor = context.shoppingState?.color ?? context.filters?.color ?? null;
  const activeOccasion = context.shoppingState?.occasion ?? context.filters?.occasion ?? null;
  const activeGender = context.shoppingState?.gender ?? context.filters?.gender ?? null;
  const activeType = context.shoppingState?.type ?? context.filters?.type ?? null;
  const activeMaxPrice = context.shoppingState?.maxPrice ?? context.filters?.maxPrice ?? null;

  const prompt = `
You are ${STORE_CONFIG.assistantName}, a friendly shopping assistant for ${STORE_CONFIG.storeName}, ${STORE_CONFIG.storeDescription}.
The customer is browsing more products for their ongoing request.

Current ShoppingState:
${stateBlock}

Search Context:
${searchBlock}

Conversation history so far:
${historyBlock}

Currently displayed product batch:
${summaryBlock}

Task:
Generate 2 to 3 short follow-up suggestions (chips) for what the customer might naturally explore next.

Rules:
- Grounded in the CURRENT ShoppingState and ongoing shopping context.
- Suggest natural next actions such as adjusting price, trying another color, trying a different style, or exploring related items.
- DO NOT repeat active constraints:
  * ${activeColor ? `Active color is "${activeColor}": do NOT suggest "Show ${activeColor} products". Suggest "Try another color" or a specific different color.` : 'Suggest a color option if relevant.'}
  * ${activeOccasion ? `Active occasion is "${activeOccasion}": do NOT suggest "Show ${activeOccasion} wear". Suggest an alternative style like "Show party wear" or "Show casual wear".` : 'Suggest an occasion option if relevant.'}
  * ${activeMaxPrice ? `Active budget constraint is under ₹${activeMaxPrice}: do NOT suggest "Show under ₹${activeMaxPrice}". Suggest a lower budget or other dimensions.` : 'Suggest budget options if relevant.'}
- NEVER suggest pagination phrases ("Show more", "More products", "Next 6", "View more", "Show similar products").
- NEVER suggest "Start over" or "Reset".
- NEVER use generic filler ("Tell me more", "What else can I help with?").
- Keep suggestions short (2 to 5 words).

Respond with ONLY a JSON object:
{
  "suggestions": ["<follow-up chip 1>", "<follow-up chip 2>", "<follow-up chip 3>"]
}

JSON:`;

  try {
    const raw = await generateWithRetry(model, prompt);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return sanitizeSuggestions(parsed.suggestions, context.shoppingState);
  } catch (err) {
    console.warn('Gemini generateContextualSuggestions failed, using safe fallback:', err);
    return getSafeFallbackSuggestions(context.shoppingState);
  }
}
