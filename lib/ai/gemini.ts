import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import 'dotenv/config';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn('GEMINI_API_KEY is not defined in environment variables');
}

export const genAI = new GoogleGenerativeAI(apiKey || '');

export function getChatModel(): GenerativeModel {
  return genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' });
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
      const isOverloaded = error?.status === 503;
      const isLastAttempt = attempt === retries;
      if (isOverloaded && !isLastAttempt) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Failed to generate content after retries');
}
