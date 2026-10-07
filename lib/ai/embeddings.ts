import { genAI } from '@/lib/ai/gemini';

const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

export async function embedQuery(text: string): Promise<number[]> {
  const result = await embeddingModel.embedContent({
    content: { parts: [{ text }], role: 'user' },
    outputDimensionality: 768,
  } as any);
  return result.embedding.values;
}
