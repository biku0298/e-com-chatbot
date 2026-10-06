import { pool } from '@/lib/db';
import { Filters, ProductSearchResult } from '@/lib/chat/types';

export async function searchProducts(
  filters: Filters,
  queryVector?: number[] | null,
  skip = 0,
  take = 6
): Promise<ProductSearchResult[]> {
  const conditions: string[] = ['embedding IS NOT NULL'];
  const params: any[] = [];
  let paramIdx = 1;

  if (filters.category) {
    conditions.push(`category = $${paramIdx++}`);
    params.push(filters.category);
  }
  if (filters.gender) {
    conditions.push(`gender = $${paramIdx++}`);
    params.push(filters.gender);
  }
  if (filters.maxPrice != null) {
    conditions.push(`price <= $${paramIdx++}`);
    params.push(filters.maxPrice);
  }
  if (filters.ageMin != null) {
    conditions.push(`"maxAge" >= $${paramIdx++}`);
    params.push(filters.ageMin);
  }
  if (filters.ageMax != null) {
    conditions.push(`"minAge" <= $${paramIdx++}`);
    params.push(filters.ageMax);
  }
  if (filters.occasion) {
    conditions.push(`occasion = $${paramIdx++}`);
    params.push(filters.occasion);
  }
  if (filters.color) {
    conditions.push(`color = $${paramIdx++}`);
    params.push(filters.color);
  }

  const whereClause = conditions.join(' AND ');

  let query: string;
  if (queryVector && queryVector.length > 0) {
    const vectorStr = `[${queryVector.join(',')}]`;
    query = `
      SELECT id, name, price, "imageUrl", color, size, gender, type, occasion
      FROM "Product"
      WHERE ${whereClause}
      ORDER BY embedding <=> $${paramIdx}::vector
      LIMIT $${paramIdx + 1}
      OFFSET $${paramIdx + 2}
    `;
    params.push(vectorStr, take, skip);
  } else {
    query = `
      SELECT id, name, price, "imageUrl", color, size, gender, type, occasion
      FROM "Product"
      WHERE ${whereClause}
      ORDER BY id
      LIMIT $${paramIdx}
      OFFSET $${paramIdx + 1}
    `;
    params.push(take, skip);
  }

  const result = await pool.query(query, params);
  return result.rows;
}
