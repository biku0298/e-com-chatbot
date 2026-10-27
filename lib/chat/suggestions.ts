import { generateWithRetry } from '@/lib/ai/gemini';
import { FUNNEL_QUESTIONS, STORE_CONFIG, type FunnelField } from '@/lib/config';
import { HistoryMessage, ProductSearchResult, ShoppingState, SuggestionContext } from './types';
import { formatHistory } from './history';
import { templateReply, type RefinementPrompt } from './funnel';

export { templateReply, type RefinementPrompt };

function formatShoppingStateBlock(state?: ShoppingState | null): string {
  if (!state) return 'None';
  const clean: Record<string, unknown> = {};
  if (state.vertical) clean.department = state.vertical;
  if (state.category) clean.category = state.category;
  if (state.type) clean.type = state.type;
  if (state.searchText) clean.searchingFor = state.searchText;
  if (state.gender) clean.gender = state.gender;
  if (state.ageMin != null || state.ageMax != null) {
    clean.age = state.ageMin === state.ageMax ? `${state.ageMin} years` : `${state.ageMin}-${state.ageMax} years`;
  }
  if (state.occasion) clean.occasion = state.occasion;
  if (state.color) clean.color = state.color;
  if (state.fit) clean.fit = state.fit;
  if (state.sleeveLength) clean.sleeveLength = state.sleeveLength;
  if (state.pattern) clean.pattern = state.pattern;
  if (state.material) clean.material = state.material;
  if (state.brand) clean.brand = state.brand;
  return Object.keys(clean).length > 0 ? JSON.stringify(clean, null, 2) : 'None';
}

/** Price is deliberately left out: replies never talk about price. */
function formatProductSummaryBlock(products: ProductSearchResult[]): string {
  const distinct = (values: (string | undefined)[]) => Array.from(new Set(values.filter(Boolean))).join(', ');
  return `Representative items: ${products.slice(0, 4).map((p) => p.name).join(', ')}
Categories: ${distinct(products.map((p) => p.category)) || 'various'}
Colors displayed: ${distinct(products.map((p) => p.color)) || 'various'}`;
}

const FIELD_NOUNS: Record<FunnelField, string> = {
  vertical: 'what kind of thing they are shopping for',
  category: 'which kind of item',
  type: 'which kind of item',
  material: 'material',
  brand: 'brand',
  sleeveLength: 'sleeve length',
  pattern: 'pattern',
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
