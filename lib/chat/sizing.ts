import { generateWithRetry } from '@/lib/ai/gemini';
import { STORE_CONFIG } from '@/lib/config';
import { HistoryMessage, SizingResult } from './types';
import { formatHistory } from './history';

// ─── Size reference table ────────────────────────────────────────────────────
// Static reference used as context for Gemini sizing answers.
// Format: { label, ageMin, ageMax, heightCmMin, heightCmMax }
export const SIZE_REFERENCE = `
Kids Clothing Size Guide (${STORE_CONFIG.storeName}):

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

/**
 * Handles the sizing-help intent.
 * Returns one of two shapes:
 *   { action: 'ask',       reply: string }                          — need more info
 *   { action: 'recommend', reply: string, ageMin, ageMax, gender }  — ready to search
 */
export async function handleSizingFlow(
  model: any,
  message: string,
  history: HistoryMessage[]
): Promise<SizingResult> {
  const historyBlock = formatHistory(history);

  const prompt = `
You are ${STORE_CONFIG.assistantName}, a friendly sizing assistant for ${STORE_CONFIG.storeName}, a kids' clothing store.
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
