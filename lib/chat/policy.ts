import { generateWithRetry } from '@/lib/ai/gemini';
import { STORE_CONFIG } from '@/lib/config';
import type { HistoryMessage, PolicyChunkSearchResult } from './types';
import { formatHistory } from './history';

/** Answer and follow-up share one grounded generation instead of two sequential calls. */
export async function generatePolicyResponse(
  model: any,
  message: string,
  chunks: PolicyChunkSearchResult[],
  history: HistoryMessage[]
): Promise<{ reply: string; suggestions: string[] }> {
  const unavailable = { reply: "I couldn't find that information in the store policies. Please contact the store for help.", suggestions: [] };
  if (chunks.length === 0) return unavailable;
  const context = chunks.map(chunk => [chunk.heading, chunk.content].filter(Boolean).join('\n')).join('\n\n');
  const prompt = `You are ${STORE_CONFIG.assistantName}, a friendly assistant for ${STORE_CONFIG.storeName}.
${formatHistory(history)}
Customer question: ${JSON.stringify(message)}
Policy information:
${context}
Answer ONLY using this policy information, in 2–4 short, clear, friendly sentences. If the answer is not covered, say so; never invent policies.
Also suggest ONE short, relevant follow-up question about these policies, or an empty suggestions array when no useful follow-up is supported.
Return only JSON: {"reply":"answer","suggestions":["follow-up question?"]}`;
  try {
    const raw = await generateWithRetry(model, prompt);
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (typeof parsed?.reply !== 'string' || !parsed.reply.trim()) return unavailable;
    return {
      reply: parsed.reply.trim(),
      suggestions: Array.isArray(parsed.suggestions)
        ? parsed.suggestions.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 120).slice(0, 1).map((value: string) => value.trim())
        : [],
    };
  } catch {
    console.warn('Gemini policy response unavailable or invalid.');
    return { reply: "I'm having trouble checking the store policies right now. Please try again in a moment.", suggestions: [] };
  }
}
