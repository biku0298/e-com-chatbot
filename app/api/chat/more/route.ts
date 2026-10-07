import { NextRequest, NextResponse } from 'next/server';
import { getChatModel } from '@/lib/ai/gemini';
import { embedQuery } from '@/lib/ai/embeddings';
import { sanitizeFilters } from '@/lib/chat/filters';
import { searchProducts } from '@/lib/search/productSearch';
import { generateContextualSuggestions } from '@/lib/chat/suggestions';
import { validateAndNormalizeShoppingState } from '@/lib/chat/conversationState';
import { HistoryMessage } from '@/lib/chat/types';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const {
    filters: rawFilters = {},
    skip = 0,
    originalQuery = '',
    shoppingState: rawState,
    history = [],
  } = (await request.json()) as {
    filters?: Record<string, any>;
    skip?: number;
    originalQuery?: string;
    shoppingState?: any;
    history?: HistoryMessage[];
  };

  const filters = sanitizeFilters(rawFilters);
  const shoppingState = validateAndNormalizeShoppingState(rawState);
  const recentHistory: HistoryMessage[] = (history as HistoryMessage[]).slice(-6);

  try {
    // Re-embed the original query so pagination uses the same vector ranking
    const queryVector = originalQuery
      ? await embedQuery(originalQuery)
      : null;

    const products = await searchProducts(filters, queryVector, skip, 6);

    const model = getChatModel();
    const suggestions = await generateContextualSuggestions(
      model,
      recentHistory,
      {
        shoppingState,
        filters,
        originalQuery,
        offset: skip,
        products,
      }
    );

    return NextResponse.json({
      products,
      suggestions,
      shoppingState,
      reply: products.length
        ? 'Here are some more options ✨'
        : "That's all we have matching those filters!",
    });
  } catch (error) {
    console.error('Pagination error:', error);
    return NextResponse.json(
      { error: 'Could not fetch more products. Please try again.' },
      { status: 500 }
    );
  }
}
