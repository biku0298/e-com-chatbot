import { NextRequest, NextResponse } from 'next/server';
import { embedQuery } from '@/lib/ai/embeddings';
import { sanitizeFilters } from '@/lib/chat/filters';
import { searchProducts } from '@/lib/search/productSearch';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const { filters: rawFilters = {}, skip = 0, originalQuery = '' } = (await request.json()) as {
    filters: Record<string, any>;
    skip: number;
    originalQuery: string;
  };

  const filters = sanitizeFilters(rawFilters);

  try {
    // Re-embed the original query so pagination uses the same vector ranking
    const queryVector = originalQuery
      ? await embedQuery(originalQuery)
      : null;

    const products = await searchProducts(filters, queryVector, skip, 6);
    return NextResponse.json({ products });
  } catch (error) {
    console.error('Pagination error:', error);
    return NextResponse.json(
      { error: 'Could not fetch more products. Please try again.' },
      { status: 500 }
    );
  }
}
