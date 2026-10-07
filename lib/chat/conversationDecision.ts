import { generateWithRetry } from '@/lib/ai/gemini';
import { STORE_CONFIG } from '@/lib/config';
import {
  ConversationDecision,
  DecisionAction,
  HistoryMessage,
  ShoppingField,
  ShoppingState,
  ShoppingStateUpdate,
} from './types';
import { formatHistory } from './history';
import {
  canSearch,
  calculateMissingFields,
  detectProductType,
  detectUnimportantFields,
  mergeShoppingState,
  normalizePrice,
  normalizeAge,
  normalizeString,
} from './conversationState';

/**
 * Natural fallback questions when a specific mandatory field is missing.
 * Questions are warm, conversational, and ask for exactly one piece of information.
 */
function getNaturalFallbackQuestion(
  missingField: ShoppingField,
  state: ShoppingState
): { question: string; suggestions: string[] } {
  switch (missingField) {
    case 'type':
    case 'category':
      return {
        question: 'What type of clothing are you looking for — like shirts, tops, dresses, or pants?',
        suggestions: ['Shirts 👕', 'Dresses 👗', 'Jeans & Pants 👖', 'Tops ✨'],
      };
    case 'gender':
      if (state.type === 'dress') {
        return {
          question: 'A dress sounds wonderful! Is it for a boy or a girl?',
          suggestions: ['For a girl 👧', 'For a boy 👦'],
        };
      }
      return {
        question: 'Sounds great! Is this for a boy or a girl?',
        suggestions: ['For a boy 👦', 'For a girl 👧'],
      };
    case 'age':
      if (state.gender === 'girls') {
        return {
          question: 'Got it! How old is your daughter, or what age group is this for?',
          suggestions: ['2-3 years', '4-5 years', '6-7 years', '8-10 years'],
        };
      }
      if (state.gender === 'boys') {
        return {
          question: 'Got it! How old is your son, or what age group is this for?',
          suggestions: ['2-3 years', '4-5 years', '6-7 years', '8-10 years'],
        };
      }
      return {
        question: 'Got it! What age is your child, or what size are you looking for?',
        suggestions: ['2-3 years', '4-5 years', '6-7 years', '8-10 years'],
      };
    case 'occasion':
      return {
        question: 'Are you shopping for everyday casual wear, a party, or a festive occasion?',
        suggestions: ['Casual wear 👕', 'Party wear 🎉', 'Ethnic / Festive 🪷'],
      };
    case 'maxPrice':
      return {
        question: 'Do you have a specific budget in mind?',
        suggestions: ['Under ₹500 💸', 'Under ₹1000 👛', 'Any budget 👍'],
      };
    case 'color':
      return {
        question: 'Do you have any favorite color in mind?',
        suggestions: ['Red ❤️', 'Blue 💙', 'Yellow 💛', 'Any color 🎨'],
      };
    default:
      return {
        question: 'Could you tell me a little more about what you have in mind?',
        suggestions: ['Show options ✨', 'Start over 🏠'],
      };
  }
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
};

/**
 * Deterministic regex extractor used as a safety fallback when the LLM
 * encounters transient errors or produces malformed JSON.
 */
function extractFallbackFromMessage(message: string): ShoppingStateUpdate {
  const lower = message.toLowerCase();
  const update: ShoppingStateUpdate = {};

  const detectedType = detectProductType(message);
  if (detectedType) update.type = detectedType;

  const unimportant = detectUnimportantFields(message);
  if (unimportant.length > 0) update.unimportantFields = unimportant;

  // Gender heuristics
  if (/\b(girls?|daughter|her|she|niece|granddaughter)\b/i.test(lower)) {
    update.gender = 'girls';
  } else if (/\b(boys?|son|him|he|nephew|grandson)\b/i.test(lower)) {
    update.gender = 'boys';
  }

  // Occasion heuristics
  if (/\b(diwali|festive|ethnic|traditional|wedding|kurta|puja)\b/i.test(lower)) {
    update.occasion = 'ethnic';
  } else if (/\b(party|birthday|celebration)\b/i.test(lower)) {
    update.occasion = 'party';
  } else if (/\b(casual|everyday|daily)\b/i.test(lower)) {
    update.occasion = 'casual';
  }

  // Color heuristics
  for (const c of ['red', 'blue', 'green', 'yellow', 'black', 'white', 'pink', 'grey', 'purple', 'orange']) {
    if (new RegExp(`\\b${c}\\b`, 'i').test(lower)) {
      update.color = c;
      break;
    }
  }

  // Age range heuristics: "between 5 and 7", "5 to 7 years"
  const rangeMatch = lower.match(/\b(?:between\s+)?(\d{1,2})\s*(?:and|to|-)\s*(\d{1,2})\s*(?:years?|yrs?|yr)?\b/i);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1], 10);
    const max = parseInt(rangeMatch[2], 10);
    if (!isNaN(min) && !isNaN(max) && min >= 0 && max <= 16) {
      update.ageMin = Math.min(min, max);
      update.ageMax = Math.max(min, max);
    }
  } else {
    // Single age heuristics: "7 year old", "age 6", "5 yrs", "she is 6", "he's 8"
    const digitMatch = lower.match(/\b(?:age\s+|is\s+|he's\s+|she's\s+)?(\d{1,2})\s*(?:years?|yrs?|yr)?\s*(?:old)?\b/i);
    if (digitMatch) {
      const ageNum = parseInt(digitMatch[1], 10);
      if (!isNaN(ageNum) && ageNum >= 0 && ageNum <= 16) {
        update.ageMin = ageNum;
        update.ageMax = ageNum;
      }
    } else {
      // Word age heuristics: "he's six", "around eight", "six years old"
      for (const [word, num] of Object.entries(NUMBER_WORDS)) {
        const wordRegex = new RegExp(`\\b(?:age|is|he's|she's|around|about)?\\s*${word}\\s*(?:years?|yrs?|yr)?\\s*(?:old)?\\b`, 'i');
        if (wordRegex.test(lower)) {
          update.ageMin = num;
          update.ageMax = num;
          break;
        }
      }
    }
  }

  // Price heuristics: "under 1000", "below 500", "under a thousand"
  if (lower.includes('thousand')) {
    update.maxPrice = normalizePrice(lower);
  } else {
    const priceMatch = lower.match(/(?:under|below|less than|within)\s*(?:₹|rs\.?|inr)?\s*(\d+)/i);
    if (priceMatch) {
      const priceNum = parseInt(priceMatch[1], 10);
      if (!isNaN(priceNum) && priceNum > 0) {
        update.maxPrice = priceNum;
      }
    }
  }

  return update;
}

/**
 * Primary decision engine for shopping conversations.
 *
 * Evaluates the customer's message within the current conversation context,
 * updates the ShoppingState, and determines whether Ray should ask ONE natural
 * clarifying question or proceed to product search.
 *
 * Guarded by deterministic server-side validation (`canSearch`).
 */
export async function decideProductConversation(
  model: any,
  message: string,
  history: HistoryMessage[],
  currentState: ShoppingState
): Promise<ConversationDecision> {
  const historyBlock = formatHistory(history);

  const stateSummary = {
    known: {
      category: currentState.category,
      type: currentState.type,
      gender: currentState.gender,
      ageMin: currentState.ageMin,
      ageMax: currentState.ageMax,
      occasion: currentState.occasion,
      color: currentState.color,
      maxPrice: currentState.maxPrice,
      fit: currentState.fit,
    },
    unimportant: currentState.unimportantFields,
    missing: currentState.missingFields,
  };

  const prompt = `
You are ${STORE_CONFIG.assistantName}, a friendly, human shopping assistant for ${STORE_CONFIG.storeName}, ${STORE_CONFIG.storeDescription}.
Your mission: understand what the customer is looking for and decide whether to ask ONE warm clarifying question or proceed with product search.

Store Catalog Knowledge:
- Categories: topwear, bottomwear
- Product types: shirt, top, shorts, jeans, skirt, dress
- Genders: boys, girls
- Occasions: casual, party, ethnic (includes Diwali/festive/traditional wear)
- Fits: regular, slim, relaxed

Current Shopping State (what we already know):
${JSON.stringify(stateSummary, null, 2)}

Conversation history so far:
${historyBlock}

Latest customer message:
"${message}"

Rules for Decision & Extraction:
1. EXTRACT updates from the latest message:
   - type: specific garment ("shirt", "top", "shorts", "jeans", "skirt", "dress") or null
   - category: "topwear" | "bottomwear" | null
   - gender: "boys" | "girls" | null (normalize: son/boy/him/nephew -> "boys", daughter/girl/her/niece -> "girls"). If not specified, return null. Do NOT guess gender.
   - age: integer age or null (e.g. "he's six", "6 years old", "she'll be 6 next month" -> 6)
   - ageMin: integer or null (e.g. "between 5 and 7" -> 5)
   - ageMax: integer or null (e.g. "between 5 and 7" -> 7)
   - occasion: "casual" | "party" | "ethnic" | null (normalize Diwali/festive/traditional/wedding -> "ethnic")
   - color: color name or null (e.g. "likes blue", "favorite color is red", "in navy blue" -> extract the color name)
   - maxPrice: number or null (e.g. "under 1000", "below a thousand" -> 1000)
   - fit: "regular" | "slim" | "relaxed" | null
   - unimportantFields: array of attributes the customer explicitly stated do not matter (e.g. "any color", "I don't care about the color" -> ["color"])

2. USER CORRECTIONS TAKE PRECEDENCE:
   If the user says "Actually for my son" or "make that for boys", change gender to "boys".
   Never retain conflicting old values when the user explicitly corrects them.

3. MANDATORY ATTRIBUTES FOR SEARCH:
   A product search can ONLY happen when ALL 3 mandatory pieces are known (or marked unimportant):
   - Garment type or category (e.g. dress, shirt, topwear)
   - Gender (boys or girls)
   - Age or usable age range (e.g. 6 years old)

   Optional attributes (color, occasion, budget, fit) improve results, but NEVER block search if the 3 mandatory attributes are present.

4. DECIDE NEXT ACTION:
   - "ask": If ANY mandatory attribute is still unknown. Formulate EXACTLY ONE natural question.
   - "search": If all mandatory attributes are known (or marked unimportant).

   The AI must NEVER return "search" just because a product keyword was detected without gender and age.

5. IF ASKING:
   - Ask for EXACTLY ONE missing piece of information.
   - Priority of questions if multiple are missing:
     1. If garment type is unknown -> ask what clothing type they're looking for.
     2. If gender is unknown -> ask if it's for a boy or a girl.
     3. If age is unknown -> ask for the child's age or age group.
   - NEVER ask multi-part robotic questions (e.g. DO NOT say "What gender, age, and budget?").
   - Acknowledge what the user said warmly (e.g. "A Diwali dress sounds lovely! Is it for a boy or a girl?").
   - Avoid robotic phrasing like "Please specify gender".
   - Provide 2-4 quick response suggestion chips.

Output JSON only in this exact shape:
{
  "intent": "product",
  "extracted": {
    "category": string | null,
    "type": string | null,
    "gender": string | null,
    "age": number | null,
    "ageMin": number | null,
    "ageMax": number | null,
    "occasion": string | null,
    "color": string | null,
    "maxPrice": number | null,
    "fit": string | null,
    "unimportantFields": string[]
  },
  "updatedUnderstanding": string,
  "missingInformation": string[],
  "recommendedAction": "ask" | "search",
  "recommendedQuestion": string | null,
  "suggestions": string[],
  "reasoning": string
}
`;

  let raw = '';
  try {
    raw = await generateWithRetry(model, prompt);
  } catch (err) {
    console.warn('Gemini decision call failed, using deterministic fallback:', err);
  }

  // Parse response
  let parsed: any = null;
  if (raw) {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.warn('Could not parse Gemini decision JSON, falling back:', cleaned);
    }
  }

  // Prepare updates to merge
  let updatesToMerge: ShoppingStateUpdate = {};

  if (parsed && typeof parsed.extracted === 'object') {
    const ext = parsed.extracted;
    updatesToMerge = {
      category: normalizeString(ext.category),
      type: normalizeString(ext.type) ?? detectProductType(message),
      gender: normalizeString(ext.gender),
      occasion: normalizeString(ext.occasion),
      color: normalizeString(ext.color),
      fit: normalizeString(ext.fit),
      maxPrice: normalizePrice(ext.maxPrice),
      unimportantFields: Array.isArray(ext.unimportantFields)
        ? (ext.unimportantFields as ShoppingField[])
        : detectUnimportantFields(message),
    };

    const normAge = normalizeAge(ext.age, ext.ageMin, ext.ageMax);
    if (normAge.ageMin !== null || normAge.ageMax !== null) {
      updatesToMerge.ageMin = normAge.ageMin;
      updatesToMerge.ageMax = normAge.ageMax;
    }
  } else {
    // Fallback deterministic extraction
    updatesToMerge = extractFallbackFromMessage(message);
  }

  // Always merge detected unimportant phrases and product types as an extra guarantee
  const autoUnimportant = detectUnimportantFields(message);
  if (autoUnimportant.length > 0) {
    updatesToMerge.unimportantFields = [
      ...(updatesToMerge.unimportantFields ?? []),
      ...autoUnimportant,
    ];
  }
  const autoType = detectProductType(message);
  if (autoType && !updatesToMerge.type) {
    updatesToMerge.type = autoType;
  }
  if (!updatesToMerge.color && !updatesToMerge.unimportantFields?.includes('color')) {
    const knownColors = ['red', 'blue', 'green', 'yellow', 'black', 'white', 'pink', 'grey', 'purple', 'orange'];
    for (const c of knownColors) {
      if (new RegExp(`\\b${c}\\b`, 'i').test(message)) {
        updatesToMerge.color = c;
        break;
      }
    }
  }

  // Merge into current state
  const mergedState = mergeShoppingState(currentState, {
    ...updatesToMerge,
    intent: 'product',
  });

  // Deterministic server-side readiness validation
  const searchAllowed = canSearch(mergedState);
  const missingFields = calculateMissingFields(mergedState);

  const recommendedAction = parsed?.recommendedAction ?? parsed?.action;
  const recommendedQuestion = parsed?.recommendedQuestion ?? parsed?.question;

  // Determine final action guarded by server-side canSearch
  let finalAction: DecisionAction = 'ask';
  let finalReply = '';
  let finalSuggestions: string[] = [];

  if (recommendedAction === 'search' && searchAllowed) {
    finalAction = 'search';
    finalReply = 'Looking for matching options now! ✨';
    finalSuggestions = [];
  } else if (searchAllowed) {
    // If all mandatory fields are satisfied
    if (recommendedAction === 'ask' && recommendedQuestion) {
      // LLM asked an optional clarifying question (e.g. budget or color)
      finalAction = 'ask';
      finalReply = recommendedQuestion;
      finalSuggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    } else {
      finalAction = 'search';
      finalReply = 'Looking for matching options now! ✨';
      finalSuggestions = [];
    }
  } else {
    // Mandatory fields are MISSING -> Enforce 'ask' regardless of LLM recommendation
    finalAction = 'ask';

    if (recommendedQuestion && recommendedAction === 'ask') {
      finalReply = recommendedQuestion;
      finalSuggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    } else {
      // Pick first missing mandatory field deterministically
      const nextMissing = missingFields[0] ?? 'gender';
      const fallback = getNaturalFallbackQuestion(nextMissing, mergedState);
      finalReply = fallback.question;
      finalSuggestions = fallback.suggestions;
    }
  }

  return {
    action: finalAction,
    reply: finalReply,
    extractedUpdates: updatesToMerge,
    updatedState: mergedState,
    missingFields,
    canSearch: searchAllowed,
    suggestions: finalSuggestions,
    reasoning: parsed?.reasoning ?? (searchAllowed ? 'All mandatory fields satisfied' : 'Missing mandatory fields'),
  };
}

