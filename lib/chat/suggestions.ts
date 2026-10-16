import { generateWithRetry } from '@/lib/ai/gemini';
import { FUNNEL_ORDER, FUNNEL_QUESTIONS, MAX_CHIPS, REMOVE_LABELS, STORE_CONFIG, funnelLabel, type FunnelField } from '@/lib/config';
import { HistoryMessage, ProductSearchResult, ShoppingState, Suggestion, SuggestionContext } from './types';
import { formatHistory } from './history';
import { toSearchFilters } from './conversationState';

/** Funnel fields still open for narrowing: not set, not marked unimportant, `type` only under a bare category. */
function remainingFunnelFields(state: ShoppingState): FunnelField[] {
  return FUNNEL_ORDER.filter(field =>
    state[field] == null &&
    !state.unimportantFields.includes(field) &&
    (field !== 'type' || state.category != null)
  );
}

/** Only values already in normalized form are used, so the refined SQL equality matches the source product. */
function funnelValue(product: ProductSearchResult, field: FunnelField): string | null {
  const value = product[field];
  if (typeof value !== 'string' || !value || value.length > 50 || value !== value.trim().toLowerCase()) return null;
  return value;
}

/**
 * Builds refinement chips from attribute values present in the products just returned.
 * Each chip's filters (current filters + one value) are satisfied by at least one of those
 * products, so a chip can never lead to an empty result, and no extra query is needed.
 */
export function buildFunnelChips(
  state: ShoppingState,
  products: ProductSearchResult[]
): { chips: Suggestion[]; nextRefinement: FunnelField | null } {
  for (const field of remainingFunnelFields(state)) {
    const counts = new Map<string, number>();
    for (const product of products) {
      const value = funnelValue(product, field);
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    if (counts.size < 2) continue;
    // Stable sort keeps first-seen order for equal frequencies.
    const chips = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_CHIPS)
      .map(([value]) => ({ label: funnelLabel(field, value), refine: { [field]: value } }));
    return { chips, nextRefinement: field };
  }
  return { chips: [], nextRefinement: null };
}

/** Zero-result chips: only offer to drop optional filters the customer set. Never price, gender, age or type. */
export function buildRemoveChips(state: ShoppingState): Suggestion[] {
  const filters = toSearchFilters(state);
  return FUNNEL_ORDER
    .filter(field => REMOVE_LABELS[field] && filters[field])
    .map(field => ({ label: REMOVE_LABELS[field]!, remove: [field] }));
}

/** Human description of the active filters, e.g. "red party dresses for girls under ₹500 for age 4". */
export function describeFilters(state: ShoppingState): string {
  const filters = toSearchFilters(state);
  const item = filters.type ? funnelLabel('type', filters.type).toLowerCase() : filters.category ?? 'items';
  const age = filters.ageMin != null && filters.ageMax != null && filters.ageMin !== filters.ageMax
    ? `for ages ${filters.ageMin}–${filters.ageMax}`
    : filters.ageMin != null ? `for age ${filters.ageMin}` : null;
  return [
    filters.color,
    filters.occasion,
    filters.fit ? `${filters.fit}-fit` : null,
    item,
    filters.gender ? `for ${filters.gender}` : null,
    filters.maxPrice != null ? `under ₹${filters.maxPrice}` : null,
    age,
  ].filter(Boolean).join(' ');
}

function formatShoppingStateBlock(state?: ShoppingState | null): string {
  if (!state) return 'None';
  const clean: Record<string, unknown> = {};
  if (state.type) clean.type = state.type;
  if (state.category) clean.category = state.category;
  if (state.gender) clean.gender = state.gender;
  if (state.ageMin != null || state.ageMax != null) {
    clean.age = state.ageMin === state.ageMax ? `${state.ageMin} years` : `${state.ageMin}-${state.ageMax} years`;
  }
  if (state.occasion) clean.occasion = state.occasion;
  if (state.color) clean.color = state.color;
  if (state.fit) clean.fit = state.fit;
  return Object.keys(clean).length > 0 ? JSON.stringify(clean, null, 2) : 'None';
}

/** Price is deliberately left out: replies never talk about price. */
function formatProductSummaryBlock(products: ProductSearchResult[]): string {
  const distinct = (values: (string | undefined)[]) => Array.from(new Set(values.filter(Boolean))).join(', ');
  return `Representative items: ${products.slice(0, 4).map((p) => p.name).join(', ')}
Types: ${distinct(products.map((p) => p.type)) || 'clothing'}
Colors displayed: ${distinct(products.map((p) => p.color)) || 'various'}
Occasions: ${distinct(products.map((p) => p.occasion)) || 'various'}`;
}

const FIELD_NOUNS: Record<FunnelField, string> = {
  type: 'which kind of item',
  occasion: 'style or occasion',
  color: 'colour',
  fit: 'fit',
};
const PRICE_TALK = /₹|\brs\b|\bprice|budget|cheap|\bunder\b/i;

/** Chip options are shown as buttons; a reply that repeats them ("…Party wear, Casual wear…") is redundant. */
function mentionsChip(reply: string, labels: string[]): boolean {
  const text = reply.toLowerCase();
  return labels.some(label => {
    const words = label.replace(/[^\p{L}\p{N}&\s-]/gu, '').trim().toLowerCase();
    return words.length > 0 && text.includes(words);
  });
}

export type RefinementPrompt ={ nextRefinement: FunnelField | null; labels: string[] };

/** Template reply used for pagination and whenever Gemini is unavailable. */
export function templateReply(intro: string, refinement: RefinementPrompt): string {
  return refinement.nextRefinement ? `${intro} ${FUNNEL_QUESTIONS[refinement.nextRefinement]}` : intro;
}

/**
 * One warm sentence introducing a non-empty results batch. Chips are built from the catalog,
 * so the model only phrases a question about the attribute those chips narrow by.
 */
export async function generateReply(
  model: any,
  message: string,
  history: HistoryMessage[],
  context: SuggestionContext,
  refinement: RefinementPrompt
): Promise<{ reply: string }> {
  const fallback = templateReply('Here are some lovely picks ✨', refinement);
  const question = refinement.nextRefinement
    ? `End with a short, natural question about ${FIELD_NOUNS[refinement.nextRefinement]} (for example "${FUNNEL_QUESTIONS[refinement.nextRefinement]}"). The options already appear as buttons below your message, so do not list, name or describe them, and do not mention any specific ${FIELD_NOUNS[refinement.nextRefinement]} values.`
    : 'Do not ask about any other attributes or options.';
  const prompt = `You are ${STORE_CONFIG.assistantName}, a friendly shopping assistant for ${STORE_CONFIG.storeName}, ${STORE_CONFIG.storeDescription}.
Current shopping requirements: ${formatShoppingStateBlock(context.shoppingState)}
${formatHistory(history)}
Latest customer message: ${JSON.stringify(message)}
Currently displayed products:
${formatProductSummaryBlock(context.products ?? [])}
Write ONE warm sentence introducing these results. ${question}
Never mention price, budget or cost. Do not repeat product names, sizes or colours from the cards. Maximum one emoji; no links or markdown.
Return only JSON: {"reply":"one sentence"}`;
  try {
    const raw = await generateWithRetry(model, prompt);
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const reply = typeof parsed?.reply === 'string' ? parsed.reply.trim() : '';
    return { reply: reply && !PRICE_TALK.test(reply) && !mentionsChip(reply, refinement.labels) ? reply : fallback };
  } catch {
    console.warn('Gemini reply generation unavailable or invalid; using template reply.');
    return { reply: fallback };
  }
}
