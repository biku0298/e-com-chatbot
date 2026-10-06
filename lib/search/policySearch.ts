import { pool } from '@/lib/db';
import { PolicyChunkSearchResult } from '@/lib/chat/types';

export async function searchPolicyChunks(
  queryVector: number[],
  topK = 5
): Promise<PolicyChunkSearchResult[]> {
  const vectorStr = `[${queryVector.join(',')}]`;
  const result = await pool.query(
    `SELECT heading, content
     FROM "PolicyChunk"
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vectorStr, topK]
  );
  return result.rows;
}
