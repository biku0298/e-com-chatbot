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
  if (state.unimportantFields.length) clean.unimportantFields = state.unimportantFields;
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

/** Shared context and rules keep first-page and pagination suggestions consistent. */
async function generateResult(
  model: any,
  history: HistoryMessage[],
  context: SuggestionContext,
  message?: string,
  productListFallback?: string
): Promise<{ reply: string; suggestions: string[] }> {
  const includeReply = message !== undefined;
  const summary = formatProductSummaryBlock(context.products, productListFallback);
  const noMatches = context.products ? context.products.length === 0 : summary.includes('No matching');
  const fallbackReply = noMatches
    ? "Couldn't find an exact match — want to try a different category or price range?"
    : 'Here are some great options for you ✨';
  const prompt = `You are ${STORE_CONFIG.assistantName}, a friendly shopping assistant for ${STORE_CONFIG.storeName}, ${STORE_CONFIG.storeDescription}.
Current shopping requirements: ${formatShoppingStateBlock(context.shoppingState)}
Search context: ${formatSearchContextBlock(context)}
${formatHistory(history)}
${includeReply ? `Latest customer message: ${JSON.stringify(message)}` : 'The customer is browsing another batch for the same request.'}
Currently displayed products:
${summary}
Generate 2–3 contextual follow-up suggestion chips, each 2–5 words, for this conversation and displayed batch.
- Preserve the current type, gender and age unless clearly offering an intentional pivot.
- Offer useful changes to budget, color, occasion/style, or related products. Do not repeat active constraints or the customer's latest request. If they just asked for cheaper items, offer a concrete lower budget or a different dimension.
- Respect attributes the customer said do not matter. Pagination does not reset shopping context.
- Never suggest pagination (Show more, More options, Next 6, Show similar), resets, or filler (Tell me more, What else, Browse more).
- Never expose technical terms, SQL, filters, RAG, or embeddings in customer-facing text.
${includeReply ? '- Also write ONE warm sentence introducing results, or suggesting an adjustment if none matched. Do not repeat product names, colors, sizes or prices from cards. Maximum one emoji; no links or markdown.' : ''}
Return only JSON: ${includeReply ? '{"reply":"one sentence","suggestions":["chip 1","chip 2","chip 3"]}' : '{"suggestions":["chip 1","chip 2","chip 3"]}'}`;
  try {
    const raw = await generateWithRetry(model, prompt);
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return {
      reply: typeof parsed?.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : fallbackReply,
      suggestions: sanitizeSuggestions(parsed?.suggestions, context.shoppingState),
    };
  } catch {
    console.warn('Gemini result generation unavailable or invalid; using contextual fallback.');
    return { reply: fallbackReply, suggestions: getSafeFallbackSuggestions(context.shoppingState) };
  }
}

export function generateReply(
  model: any,
  message: string,
  productListFallback: string,
  history: HistoryMessage[],
  context: SuggestionContext = {}
): Promise<{ reply: string; suggestions: string[] }> {
  return generateResult(model, history, context, message, productListFallback);
}

/** Pagination still gets fresh Gemini suggestions without generating an unused reply. */
export async function generateContextualSuggestions(
  model: any,
  history: HistoryMessage[],
  context: SuggestionContext
): Promise<string[]> {
  return (await generateResult(model, history, context)).suggestions;
}
