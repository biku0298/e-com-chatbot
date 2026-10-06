import { generateWithRetry } from '@/lib/ai/gemini';
import { Filters, HistoryMessage } from './types';
import { formatHistory } from './history';

/**
 * Coerces all numeric fields in the raw Gemini JSON to actual JS numbers.
 * Gemini sometimes returns numbers as strings (e.g. "500" instead of 500).
 * This runs immediately after JSON.parse so the rest of the code can trust types.
 */
export function sanitizeFilters(raw: Record<string, any>): Filters {
  const toIntOrNull = (v: any): number | null => {
    const n = parseInt(v, 10);
    return isNaN(n) ? null : n;
  };
  const toFloatOrNull = (v: any): number | null => {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };
  return {
    category: raw.category ?? null,
    type:     raw.type     ?? null,
    gender:   raw.gender   ?? null,
    occasion: raw.occasion ?? null,
    color: raw.color ?? null,
    maxPrice: raw.maxPrice != null ? toFloatOrNull(raw.maxPrice) : null,
    ageMin: raw.ageMin != null ? toIntOrNull(raw.ageMin) : null,
    ageMax: raw.ageMax != null ? toIntOrNull(raw.ageMax) : null,
  };
}

/**
 * Extracts shopping filters from customer message and history using Gemini
 */
export async function extractFilters(
  model: any,
  message: string,
  history: HistoryMessage[]
): Promise<Filters> {
  const historyBlock = formatHistory(history);

  const prompt = `
Extract shopping filters from this customer message for a kids' clothing store.
Return ONLY valid JSON, no explanation, no markdown formatting.

Fields (use null if not mentioned):
- category: "topwear" or "bottomwear" or null
- gender: "boys" or "girls" or null
- maxPrice: number or null
- ageMin: integer (youngest age in years) or null — e.g. if customer says "5 year old" return 5; "3-6 years" return 3; "toddler" return 1
- ageMax: integer (oldest age in years) or null — e.g. if customer says "5 year old" return 5; "3-6 years" return 6; "toddler" return 3
- occasion: "casual" or "party" or "ethnic" or null — use "party" for birthday/festive/celebration; "ethnic" for traditional/ethnic/cultural wear; "casual" for everyday wear; null if not mentioned
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
