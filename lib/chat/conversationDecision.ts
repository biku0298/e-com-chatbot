import { generateWithRetry } from '@/lib/ai/gemini';
import { STORE_CONFIG } from '@/lib/config';
import type { ConversationDecision, HistoryMessage, ShoppingState, ShoppingStateUpdate } from './types';
import type { Catalog } from '../catalog/types';
import { formatHistory } from './history';
import { clearItemFields, detectUnimportantFields, mergeShoppingState, normalizePrice } from './conversationState';

const PRICE_CHIP = /₹|\brs\b|price|budget|cheap|under/i;

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen'];

/** Accept explicit ages, or a bare age when answering an age question. Never infer age from prices or quantities. */
function extractAge(message: string, history: HistoryMessage[]): ShoppingStateUpdate {
  const text = message.toLowerCase().replace(new RegExp(`\\b(${NUMBER_WORDS.join('|')})\\b`, 'g'), word => String(NUMBER_WORDS.indexOf(word)));
  const number = '(\\d{1,2})(?![\\d.])';
  const range = `${number}\\s*(?:-|to|and)\\s*${number}`;
  const otherUnit = '(?!\\s*(?:months?|mos?|cm|centimet(?:er|re)s?|inches?|kg|kilograms?)\\b)';
  const explicit = [
    new RegExp(`\\b${range}\\s*(?:years?|yrs?)\\b`),
    new RegExp(`\\b(?:ages?|aged)\\s+(?:between\\s+)?${number}(?:\\s*(?:-|to|and)\\s*${number})?\\b${otherUnit}`),
    new RegExp(`\\b${number}[\\s-]*(?:years?|yrs?)(?:[\\s-]*old)?\\b`),
    new RegExp(`\\b(?:he|she|son|daughter|child|kid)(?:\\s+is|'s)\\s+${number}\\b${otherUnit}`),
  ];
  let match = explicit.map(pattern => text.match(pattern)).find(Boolean);
  const lastBot = [...history].reverse().find(item => item.sender === 'bot');
  if (!match && /\b(age|ages|how old)\b/i.test(lastBot?.text ?? '')) {
    match = text.match(new RegExp(`^(?:about\\s+|around\\s+|between\\s+)?${number}(?:\\s*(?:-|to|and)\\s*${number})?[.!]?$`));
  }
  if (!match) return {};
  const min = Number(match[1]);
  const max = Number(match[2] ?? match[1]);
  return min <= 16 && max <= 16 ? { ageMin: Math.min(min, max), ageMax: Math.max(min, max) } : {};
}

/**
 * Regex fallback for the fields every catalog shares (gender, age, budget, "doesn't matter").
 * Item, colour and material words are resolved by the catalog itself.
 */
function extractFallbackFromMessage(message: string, history: HistoryMessage[]): ShoppingStateUpdate {
  const lower = message.toLowerCase();
  const update: ShoppingStateUpdate = {
    unimportantFields: detectUnimportantFields(message),
    ...extractAge(message, history),
  };
  if (/\b(girls?|daughter|her|she|niece|granddaughter)\b/i.test(lower)) update.gender = 'girls';
  else if (/\b(boys?|son|him|he|nephew|grandson)\b/i.test(lower)) update.gender = 'boys';
  const price = lower.match(/(?:under|below|less than|within|budget(?:\s+of)?)\s*(?:₹|rs\.?|inr)?\s*((?:\d[\d,]*(?:\.\d+)?\s*k?)|(?:(?:a|one|two|three) thousand)|five hundred)\b/i);
  if (price) update.maxPrice = normalizePrice(price[1]);
  return update;
}

/** Item fields the catalog resolves itself (the model and regex fallback never set them). */
const ITEM_FIELDS = ['vertical', 'category', 'type', 'occasion', 'color', 'fit', 'material', 'brand', 'searchText'] as const;

/**
 * Gemini interprets the message; normalized state alone decides when searching is allowed.
 * `catalog` supplies the catalog description, item mapping and required-field rule.
 */
export async function decideProductConversation(
  model: any,
  message: string,
  history: HistoryMessage[],
  currentState: ShoppingState,
  catalog: Catalog
): Promise<ConversationDecision> {
  const prompt = `You are ${STORE_CONFIG.assistantName}, a warm shopping assistant for ${STORE_CONFIG.storeName}, ${STORE_CONFIG.storeDescription}.
Understand the latest message in context and extract only new requirements or explicit corrections. Unmentioned values are null; do not erase prior requirements or guess gender.
${catalog.promptCatalog}
Current state: ${JSON.stringify(currentState)}
${formatHistory(history)}
Latest message: ${JSON.stringify(message)}
${catalog.promptSearchRule}
If required information is missing after applying updates, ask ONE warm contextual question, in priority order: type, category, gender, age. Acknowledge what the customer said and offer 2–4 short response chips. Chips must never be about price or budget. Otherwise question is null and suggestions is empty.
Return only JSON with this shape (no explanation):
{"extracted":${catalog.extractionShape},"question":null,"suggestions":[]}`;

  let parsed: any;
  try {
    const raw = await generateWithRetry(model, prompt);
    parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    console.warn('Gemini decision unavailable or invalid; using conversation fallback.');
  }

  const fallback = extractFallbackFromMessage(message, history);
  const extracted = parsed?.extracted;
  const validExtraction = extracted && typeof extracted === 'object' && !Array.isArray(extracted);
  const updates: ShoppingStateUpdate = validExtraction ? { ...extracted } : { ...fallback };
  updates.unimportantFields = [
    ...(Array.isArray(updates.unimportantFields) ? updates.unimportantFields : []),
    ...(fallback.unimportantFields ?? []),
  ];
  // The catalog maps item, colour and material words to its own slugs.
  for (const field of ITEM_FIELDS) delete updates[field];
  const resolved = catalog.resolveItem(message, validExtraction ? extracted : null, currentState);
  Object.assign(updates, resolved.update);
  const baseState = resolved.replacesItem ? clearItemFields(currentState) : currentState;
  // An explicit "any color" must win over both a stale model value and the regex safeguard.
  for (const field of fallback.unimportantFields ?? []) {
    if (field !== 'age') delete updates[field as keyof ShoppingStateUpdate];
  }

  const merged = mergeShoppingState(baseState, { ...updates, intent: 'product' });
  const missingFields = catalog.missingFields(merged);
  const isReadyForSearch = missingFields.length === 0;
  const updatedState: ShoppingState = { ...merged, missingFields, isReadyForSearch };
  const fallbackQuestion = catalog.fallbackQuestion(missingFields[0] ?? 'age', updatedState);
  const question = catalog.useModelQuestion !== false && typeof parsed?.question === 'string' ? parsed.question.trim() : '';
  const suggestions = Array.isArray(parsed?.suggestions)
    ? parsed.suggestions.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 80 && !PRICE_CHIP.test(value)).slice(0, 4)
    : [];
  return {
    action: isReadyForSearch ? 'search' : 'ask',
    reply: isReadyForSearch ? 'Looking for matching options now! ✨' : question || fallbackQuestion.question,
    suggestions: isReadyForSearch ? [] : question && suggestions.length ? suggestions.map((label: string) => ({ label })) : fallbackQuestion.suggestions,
    extractedUpdates: updates,
    updatedState,
    missingFields,
    canSearch: isReadyForSearch,
  };
}
