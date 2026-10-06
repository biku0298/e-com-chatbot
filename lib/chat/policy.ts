import { generateWithRetry } from '@/lib/ai/gemini';
import { HistoryMessage, PolicyChunkSearchResult } from './types';
import { formatHistory } from './history';

// ─── Policy RAG answer ────────────────────────────────────────────────────────

export async function generatePolicyAnswer(
  model: any,
  message: string,
  chunks: PolicyChunkSearchResult[],
  history: HistoryMessage[]
): Promise<string> {
  const historyBlock = formatHistory(history);
  const context = chunks
    .map((c) => (c.heading ? `[${c.heading}]\n${c.content}` : c.content))
    .join('\n\n');

  const prompt = `
You are Ray, a friendly assistant for Bachpankart, a kids' products store.
${historyBlock}

A customer asked: "${message}"

Answer ONLY using the policy information below. Do not make anything up.
If the answer is not covered by the context, say so politely.
Keep the answer short, clear, and friendly — 2–4 sentences max.

Policy context:
${context}

Answer:`;

  const raw = await generateWithRetry(model, prompt);
  return raw.trim();
}

// ─── Policy follow-up suggestion ─────────────────────────────────────────────

/**
 * Generates ONE short follow-up question a customer might naturally ask
 * after receiving a policy answer (e.g. "How do I track my order?").
 */
export async function generatePolicySuggestion(
  model: any,
  policyAnswer: string
): Promise<string> {
  const prompt = `
A customer just received this policy answer from a kids' store chatbot:
"${policyAnswer}"

Write ONE short follow-up question the customer might naturally ask next.
Examples: "How do I track my order?", "Can I exchange for a different size?", "How long does delivery take?"
Return ONLY the question, no explanation, no punctuation at the end.
Question:`;
  const raw = await generateWithRetry(model, prompt);
  return raw.trim().replace(/[?.!]+$/, '').trim() + '?';
}
