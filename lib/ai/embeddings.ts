import { genAI } from '@/lib/ai/gemini';

export async function embedQuery(text: string): Promise<number[]> {
  const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
  const result = await embeddingModel.embedContent({
    content: { parts: [{ text }], role: 'user' },
    outputDimensionality: 768,
  } as any);
  return result.embedding.values;
}
