import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import 'dotenv/config';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn('GEMINI_API_KEY is not defined in environment variables');
}

export const genAI = new GoogleGenerativeAI(apiKey || '');

let chatModel: GenerativeModel | undefined;
export function getChatModel(): GenerativeModel {
  return chatModel ??= genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' });
}

export async function generateWithRetry(
  model: GenerativeModel | any,
  prompt: string,
  retries = 2
): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error: any) {
      const isRetryable =
        error?.status === 503 ||
        error?.status === 429 ||
        error?.message?.includes('429') ||
        error?.message?.includes('RESOURCE_EXHAUSTED') ||
        error?.message?.includes('quota');
      const isLastAttempt = attempt === retries;
      if (isRetryable && !isLastAttempt) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Failed to generate content after retries');
}
