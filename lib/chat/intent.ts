import { generateWithRetry } from '@/lib/ai/gemini';
import { HistoryMessage, Intent } from './types';
import { formatHistory } from './history';

/**
 * Returns 'product' | 'policy' | 'general' | 'sizing'.
 * Uses keyword heuristics first (instant), Gemini fallback for ambiguous cases.
 */
export async function classifyIntent(
  model: any,
  message: string,
  history: HistoryMessage[]
): Promise<Intent> {
  const lower = message.toLowerCase().trim();

  // Exact small-talk words
  const exactGeneralWords = ['help', 'thanks', 'thank you', 'bye', 'ok', 'okay', 'cool'];
  if (exactGeneralWords.includes(lower)) {
    return 'general';
  }

  // Greeting phrases
  const greetingKeywords = [
    'hi', 'hello', 'hey', 'hii', 'helo', 'howdy', 'namaste',
    'good morning', 'good evening', 'good afternoon',
    'how are you', 'what can you do', 'who are you', 'what are you',
  ];
  if (greetingKeywords.some((kw) => lower === kw || lower.startsWith(kw + ' ') || lower.endsWith(' ' + kw))) {
    return 'general';
  }

  // Sizing intent — queries specifically asking about sizing or fit recommendations
  const sizingKeywords = [
    'what size', 'which size', 'right size', 'find the right size', 'help me find the right size',
    'size guide', 'sizing', 'size chart', 'size for a', 'size for my',
  ];
  if (sizingKeywords.some((kw) => lower.includes(kw))) return 'sizing';

  // Check if conversation history shows we're mid-sizing-flow
  const lastBotMsg = [...history].reverse().find((m) => m.sender === 'bot');
  if (
    lastBotMsg &&
    (lastBotMsg.text.toLowerCase().includes('age') ||
      lastBotMsg.text.toLowerCase().includes('height') ||
      lastBotMsg.text.toLowerCase().includes('cm') ||
      lastBotMsg.text.toLowerCase().includes('size')) &&
    /\d/.test(message) // user replied with a number — likely age/height
  ) {
    return 'sizing';
  }

  const policyKeywords = [
    'return', 'refund', 'exchange', 'cancel', 'policy', 'days',
    'replace', 'warranty', 'damaged', 'wrong item', 'ship', 'delivery',
    'how long', 'when will', 'eligible', 'inspection',
  ];
  if (policyKeywords.some((kw) => lower.includes(kw))) return 'policy';

  const productKeywords = [
    'shirt', 'top', 'dress', 'jeans', 'skirt', 'shorts', 'buy', 'show',
    'find', 'suggest', 'recommend', 'under ₹', 'cheap', 'affordable',
    'boys', 'girls', 'boy', 'girl', 'son', 'daughter', 'kids', 'toddler',
    'birthday', 'gift', 'clothes', 'wear', 'outfit', 'color', 'price', 'collection',
  ];
  if (productKeywords.some((kw) => lower.includes(kw))) return 'product';

  // Fallback: ask Gemini for ambiguous cases
  const historyBlock = formatHistory(history);
  const prompt = `
You are classifying a customer message for a kids' clothing store chatbot.
Return ONLY one word: "product", "policy", "general", or "sizing".
- "product" = shopping, browsing, finding clothes, recommendations, gifts
- "policy" = returns, refunds, exchanges, shipping, delivery, cancellation
- "general" = greetings, small talk, questions about the chatbot itself
- "sizing" = finding the right size, age-to-size help, height-based sizing
${historyBlock}
Message: "${message}"
Answer:`;

  try {
    const raw = await generateWithRetry(model, prompt);
    const word = raw.trim().toLowerCase();
    if (word.startsWith('policy')) return 'policy';
    if (word.startsWith('general')) return 'general';
    if (word.startsWith('sizing')) return 'sizing';
    return 'product';
  } catch {
    return 'product';
  }
}

/**
 * General conversational reply (greetings / small talk)
 */
export async function generateGeneralReply(
  model: any,
  message: string,
  history: HistoryMessage[]
): Promise<string> {
  const historyBlock = formatHistory(history);
  const prompt = `
You are Ray, a friendly shopping assistant for Bachpankart, a kids' products store.
${historyBlock}
Customer said: "${message}"
Reply in ONE short, warm, friendly sentence. Do NOT mention products or policies unless directly asked.
Answer:`;
  const raw = await generateWithRetry(model, prompt);
  return raw.trim();
}
