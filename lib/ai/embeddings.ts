import { createQueryCache } from './queryCache';
import { genAI } from '@/lib/ai/gemini';

const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

async function generateEmbedding(text: string): Promise<number[]> {
  const result = await embeddingModel.embedContent({
    content: { parts: [{ text }], role: 'user' },
    outputDimensionality: 768,
  } as any);
  return result.embedding.values;
}

// Reuse ranking vectors across Show More pages; failed calls are never cached.
export const embedQuery = createQueryCache(generateEmbedding);
