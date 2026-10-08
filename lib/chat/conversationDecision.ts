import { generateWithRetry } from '@/lib/ai/gemini';
import { STORE_CONFIG } from '@/lib/config';
import type { ConversationDecision, HistoryMessage, ShoppingField, ShoppingState, ShoppingStateUpdate } from './types';
import { formatHistory } from './history';
import { detectProductType, detectUnimportantFields, mergeShoppingState, normalizePrice } from './conversationState';

function getNaturalFallbackQuestion(field: ShoppingField) {
  if (field === 'type' || field === 'category') {
    return { question: 'What type of clothing are you looking for — like shirts, tops, dresses, or pants?', suggestions: ['Shirts 👕', 'Dresses 👗', 'Jeans & Pants 👖', 'Tops ✨'] };
  }
  if (field === 'gender') {
    return { question: 'Sounds great! Is this for a boy or a girl?', suggestions: ['For a boy 👦', 'For a girl 👧'] };
  }
  return { question: 'Got it! How old is the child, or what age group is this for?', suggestions: ['2-3 years', '4-5 years', '6-7 years', '8-10 years'] };
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen'];
const COLORS = ['red', 'blue', 'green', 'yellow', 'black', 'white', 'pink', 'grey', 'purple', 'orange'];

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

/** One pass supplies fallback extraction and the explicit type/color/no-preference safeguards. */
function extractFallbackFromMessage(message: string, history: HistoryMessage[]): ShoppingStateUpdate {
  const lower = message.toLowerCase();
  const update: ShoppingStateUpdate = {
    type: detectProductType(message),
    unimportantFields: detectUnimportantFields(message),
    ...extractAge(message, history),
  };
  if (/\b(girls?|daughter|her|she|niece|granddaughter)\b/i.test(lower)) update.gender = 'girls';
  else if (/\b(boys?|son|him|he|nephew|grandson)\b/i.test(lower)) update.gender = 'boys';
  if (/\b(diwali|festive|ethnic|traditional|wedding|kurta|puja)\b/i.test(lower)) update.occasion = 'ethnic';
  else if (/\b(party|birthday|celebration)\b/i.test(lower)) update.occasion = 'party';
  else if (/\b(casual|everyday|daily)\b/i.test(lower)) update.occasion = 'casual';
  update.color = COLORS.find(color => new RegExp(`\\b${color}\\b`, 'i').test(lower));
  const price = lower.match(/(?:under|below|less than|within|budget(?:\s+of)?)\s*(?:₹|rs\.?|inr)?\s*((?:\d[\d,]*(?:\.\d+)?\s*k?)|(?:(?:a|one|two|three) thousand)|five hundred)\b/i);
  if (price) update.maxPrice = normalizePrice(price[1]);
  return update;
}

/** Gemini interprets the message; normalized state alone decides when searching is allowed. */
export async function decideProductConversation(
  model: any,
  message: string,
  history: HistoryMessage[],
  currentState: ShoppingState
): Promise<ConversationDecision> {
  const prompt = `You are ${STORE_CONFIG.assistantName}, a warm shopping assistant for ${STORE_CONFIG.storeName}, ${STORE_CONFIG.storeDescription}.
Understand the latest message in context and extract only new requirements or explicit corrections. Unmentioned values are null; do not erase prior requirements or guess gender.
Catalog: types shirt/top/shorts/jeans/skirt/dress; categories topwear/bottomwear; genders boys/girls; occasions casual/party/ethnic; fits regular/slim/relaxed.
Normalize son/boy/him/nephew to boys; daughter/girl/her/niece to girls. Diwali/festive/traditional/wedding means ethnic.
Extract age or ageMin/ageMax from age expressions, including "he's six" or "between 5 and 7". Prices and item quantities are not ages.
Extract maxPrice numerically ("under a thousand" means 1000), colors and fit when given. Mark explicitly irrelevant attributes in unimportantFields, e.g. "any color" means color is unimportant.
Current state: ${JSON.stringify(currentState)}
${formatHistory(history)}
Latest message: ${JSON.stringify(message)}
Search requires garment type OR category, gender, and age, each known or explicitly unimportant. Budget/color/occasion/fit are optional.
If required information is missing after applying updates, ask ONE warm contextual question, in priority order: type, gender, age. Acknowledge what the customer said and offer 2–4 short response chips. Otherwise question is null and suggestions is empty.
Return only JSON with this shape (no explanation):
{"extracted":{"category":null,"type":null,"gender":null,"age":null,"ageMin":null,"ageMax":null,"occasion":null,"color":null,"maxPrice":null,"fit":null,"unimportantFields":[]},"question":null,"suggestions":[]}`;

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
  updates.type = updates.type || fallback.type;
  updates.unimportantFields = [
    ...(Array.isArray(updates.unimportantFields) ? updates.unimportantFields : []),
    ...(fallback.unimportantFields ?? []),
  ];
  if (!updates.color) updates.color = fallback.color;
  // An explicit "any color" must win over both a stale model value and the regex safeguard.
  for (const field of fallback.unimportantFields ?? []) {
    if (field !== 'age') delete updates[field];
  }

  const updatedState = mergeShoppingState(currentState, { ...updates, intent: 'product' });
  const { isReadyForSearch, missingFields } = updatedState;
  const fallbackQuestion = getNaturalFallbackQuestion(missingFields[0] ?? 'age');
  const question = typeof parsed?.question === 'string' ? parsed.question.trim() : '';
  const suggestions = Array.isArray(parsed?.suggestions)
    ? parsed.suggestions.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 80).slice(0, 4)
    : [];
  return {
    action: isReadyForSearch ? 'search' : 'ask',
    reply: isReadyForSearch ? 'Looking for matching options now! ✨' : question || fallbackQuestion.question,
    suggestions: isReadyForSearch ? [] : question && suggestions.length ? suggestions : fallbackQuestion.suggestions,
    extractedUpdates: updates,
    updatedState,
    missingFields,
    canSearch: isReadyForSearch,
  };
}
