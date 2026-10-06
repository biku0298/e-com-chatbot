import { generateWithRetry } from '@/lib/ai/gemini';
import { Filters, HistoryMessage } from './types';
import { formatHistory } from './history';

export async function generateReply(
  model: any,
  message: string,
  productList: string,
  history: HistoryMessage[]
): Promise<{ reply: string; suggestions: string[] }> {
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

/**
 * Returns exactly 2 context-aware follow-up suggestion chips.
 *
 * Design rules:
 *  - Uses ONLY the already-extracted filters object — no keyword scanning
 *  - Never contradicts a filter the user has already specified
 *  - Never mentions gender (it is a user constraint, not a suggestion gap)
 *  - Never suggests "show more" (that is the fixed chip's job)
 *  - Always returns exactly 2 chips
 *
 * Gap-filling decision tree (based on which of occasion / price / color
 * are still unspecified):
 *
 *   all 3 open        → alternate: [occasion, occasion] OR [occasion, price]
 *   occasion closed    → [price, color]
 *   price closed       → [occasion, color]
 *   color closed       → [occasion, price]
 *   2 of 3 closed       → [the one open gap, "Show in different colors"]
 *   all 3 closed       → ["Show in different colors", "Show cheaper options"]
 */
export function pickSmartSuggestions(filters: Filters): string[] {
  const occasionOpen = !filters.occasion;
  const priceOpen = filters.maxPrice == null;
  const colorOpen = !filters.color;

  const OCCASION_CHIP: Record<string, string> = {
    party: 'Show party wear 🎉',
    ethnic: 'Show ethnic wear 🪷',
    casual: 'Show casual wear 👕',
  };
  const ALL_OCCASIONS = ['party', 'ethnic', 'casual'] as const;
  const PRICE_CHIP = 'Show budget-friendly options 💸';
  const COLOR_CHIP = 'Show in different colors 🎨';

  function twoOccasionOptions(exclude: string | null = null): string[] {
    const options = ALL_OCCASIONS.filter((o) => o !== exclude);
    return [OCCASION_CHIP[options[0]], OCCASION_CHIP[options[1]]];
  }

  const openCount = [occasionOpen, priceOpen, colorOpen].filter(Boolean).length;

  // Case 1: nothing specified yet — alternate between two patterns
  if (openCount === 3) {
    const useOccasionPair = Math.random() < 0.5;
    if (useOccasionPair) {
      return twoOccasionOptions();
    }
    return [OCCASION_CHIP['party'], PRICE_CHIP];
  }

  // Case 2: occasion already specified — ask price + color
  if (!occasionOpen && priceOpen && colorOpen) {
    return [PRICE_CHIP, COLOR_CHIP];
  }

  // Case 3: price already specified — ask occasion + color
  if (occasionOpen && !priceOpen && colorOpen) {
    return [twoOccasionOptions()[0], COLOR_CHIP];
  }

  // Case 4: color already specified — ask occasion + price
  if (occasionOpen && priceOpen && !colorOpen) {
    return [twoOccasionOptions()[0], PRICE_CHIP];
  }

  // Case 5: exactly one gap remains open (two of three already specified)
  if (openCount === 1) {
    if (occasionOpen) {
      const currentOccasion = filters.occasion ?? null;
      return [twoOccasionOptions(currentOccasion)[0], COLOR_CHIP];
    }
    if (priceOpen) {
      return [PRICE_CHIP, COLOR_CHIP];
    }
    // colorOpen is the only remaining gap
    return [COLOR_CHIP, PRICE_CHIP];
  }

  // Case 6: all three already specified — safe generic fallback
  return [COLOR_CHIP, PRICE_CHIP];
}
