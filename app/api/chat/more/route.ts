import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pg from 'pg';

export const maxDuration = 60;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL!,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  connectionTimeoutMillis: 30000,
});

type Filters = {
  category?: string | null;
  type?: string | null;
  gender?: string | null;
  maxPrice?: number | null;
  ageMin?: number | null;
  ageMax?: number | null;
  occasion?: string | null;
  color?: string | null;
};

async function embedQuery(text: string): Promise<number[]> {
  const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
  const result = await embeddingModel.embedContent({
    content: { parts: [{ text }], role: 'user' },
    outputDimensionality: 768,
  } as any);
  return result.embedding.values;
}

export async function POST(request: NextRequest) {
  const { filters: rawFilters = {}, skip = 0, originalQuery = '' } = (await request.json()) as {
    filters: Record<string, any>;
    skip: number;
    originalQuery: string;
  };

  // Coerce numeric fields — the frontend sends JSON that may contain string numbers
  const toInt   = (v: any) => { const n = parseInt(v, 10);  return isNaN(n) ? null : n; };
  const toFloat = (v: any) => { const n = parseFloat(v);    return isNaN(n) ? null : n; };
  const filters: Filters = {
    category: rawFilters.category ?? null,
    type:     rawFilters.type     ?? null,
    gender:   rawFilters.gender   ?? null,
    occasion: rawFilters.occasion ?? null,
    color:    rawFilters.color    ?? null,
    maxPrice: rawFilters.maxPrice != null ? toFloat(rawFilters.maxPrice) : null,
    ageMin:   rawFilters.ageMin   != null ? toInt(rawFilters.ageMin)     : null,
    ageMax:   rawFilters.ageMax   != null ? toInt(rawFilters.ageMax)     : null,
  };

  try {
    // Re-embed the original query so pagination uses the same vector ranking
    const queryVector = originalQuery
      ? await embedQuery(originalQuery)
      : null;

    const conditions: string[] = ['embedding IS NOT NULL'];
    const params: any[] = [];
    let paramIdx = 1;

    if (filters.type)     { conditions.push(`type = $${paramIdx++}`);     params.push(filters.type); }
    else if (filters.category) { conditions.push(`category = $${paramIdx++}`); params.push(filters.category); }
    if (filters.gender)   { conditions.push(`gender = $${paramIdx++}`);   params.push(filters.gender); }
    if (filters.maxPrice != null) { conditions.push(`price <= $${paramIdx++}`);   params.push(filters.maxPrice); }
    if (filters.ageMin != null) { conditions.push(`"maxAge" >= $${paramIdx++}`); params.push(filters.ageMin); }
    if (filters.ageMax != null) { conditions.push(`"minAge" <= $${paramIdx++}`); params.push(filters.ageMax); }
    if (filters.occasion) { conditions.push(`occasion = $${paramIdx++}`); params.push(filters.occasion); }
    if (filters.color)   { conditions.push(`color = $${paramIdx++}`);    params.push(filters.color); }

    const whereClause = conditions.join(' AND ');

    let query: string;
    if (queryVector) {
      const vectorStr = `[${queryVector.join(',')}]`;
      query = `
        SELECT id, name, price, "imageUrl", color, size, gender, type, occasion
        FROM "Product"
        WHERE ${whereClause}
        ORDER BY embedding <=> $${paramIdx}::vector
        LIMIT $${paramIdx + 1}
        OFFSET $${paramIdx + 2}
      `;
      params.push(vectorStr, 6, skip);
    } else {
      // Fallback: no query vector, just filter + offset
      query = `
        SELECT id, name, price, "imageUrl", color, size, gender, type, occasion
        FROM "Product"
        WHERE ${whereClause}
        ORDER BY id
        LIMIT $${paramIdx}
        OFFSET $${paramIdx + 1}
      `;
      params.push(6, skip);
    }

    const result = await pool.query(query, params);
    return NextResponse.json({ products: result.rows });
  } catch (error) {
    console.error('Pagination error:', error);
    return NextResponse.json(
      { error: 'Could not fetch more products. Please try again.' },
      { status: 500 }
    );
  }
}
