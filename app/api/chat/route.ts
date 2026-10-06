import { NextRequest, NextResponse } from 'next/server';
import { getChatModel } from '@/lib/ai/gemini';
import { embedQuery } from '@/lib/ai/embeddings';
import { HistoryMessage, Filters } from '@/lib/chat/types';
import { classifyIntent, generateGeneralReply } from '@/lib/chat/intent';
import { extractFilters } from '@/lib/chat/filters';
import { handleSizingFlow } from '@/lib/chat/sizing';
import { generatePolicyAnswer, generatePolicySuggestion } from '@/lib/chat/policy';
import { generateReply, pickSmartSuggestions } from '@/lib/chat/suggestions';
import { searchProducts } from '@/lib/search/productSearch';
import { searchPolicyChunks } from '@/lib/search/policySearch';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const { message, history = [] } = await request.json();

  if (!message || typeof message !== 'string') {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  }

  // Keep only last 6 messages to limit prompt size
  const recentHistory: HistoryMessage[] = (history as HistoryMessage[]).slice(-6);

  try {
    const model = getChatModel();

    // Step 1: classify intent first (keyword heuristic is instant for most messages)
    const intent = await classifyIntent(model, message, recentHistory);

    // ── General branch (greetings / small talk) ────────────────────────────
    // No embedding, no DB query — just a quick conversational reply
    if (intent === 'general') {
      const generalReply = await generateGeneralReply(model, message, recentHistory);
      return NextResponse.json({
        reply: generalReply,
        products: [],
        suggestions: ['Show tops for boys', 'Dresses for girls', 'Gifts under ₹500'],
        filters: {},
      });
    }

    // ── Sizing branch ─────────────────────────────────────────────────────────
    if (intent === 'sizing') {
      const sizingResult = await handleSizingFlow(model, message, recentHistory);

      if (sizingResult.action === 'ask') {
        // Still gathering info — return just the clarifying question, no products
        return NextResponse.json({
          reply: sizingResult.reply,
          products: [],
          isSizing: true,
          suggestions: [],
          filters: {},
        });
      }

      // action === 'recommend' — run product search with the determined age range
      const sizeFilters: Filters = {
        ageMin: sizingResult.ageMin,
        ageMax: sizingResult.ageMax,
        gender: sizingResult.gender as string | null,
      };
      const queryVector = await embedQuery(message);
      const products = await searchProducts(sizeFilters, queryVector);
      const productList = products.length
        ? products.map((p) => `- ${p.name} (${p.color}, ${p.size}) — ₹${p.price}`).join('\n')
        : 'No matching products found in the catalog.';
      const { suggestions } = await generateReply(model, message, productList, recentHistory);

      return NextResponse.json({
        reply: sizingResult.reply,
        products,
        isSizing: false, // has products — use product chip set
        suggestions,
        filters: sizeFilters,
      });
    }

    // For product + policy: embed the query (needed for both vector searches)
    const [filters, queryVector] = await Promise.all([
      extractFilters(model, message, recentHistory),
      embedQuery(message),
    ]);

    // ── Policy branch ────────────────────────────────────────────────────────
    if (intent === 'policy') {
      const policyChunks = await searchPolicyChunks(queryVector);
      const policyAnswer = await generatePolicyAnswer(model, message, policyChunks, recentHistory);
      // Generate one context-aware follow-up suggestion in parallel (non-blocking on answer)
      const policySuggestion = await generatePolicySuggestion(model, policyAnswer);
      return NextResponse.json({
        reply: policyAnswer,
        products: [],
        isPolicy: true,
        suggestions: [policySuggestion],
        filters: {},
      });
    }

    // ── Product branch ───────────────────────────────────────────────────────

    // Step 2: hybrid search — structured filters + vector similarity ranking
    const products = await searchProducts(filters, queryVector);

    // Step 3: ask Gemini to write the reply text
    const productList = products.length
      ? products.map((p) => `- ${p.name} (${p.color}, ${p.size}) — ₹${p.price}`).join('\n')
      : 'No matching products found in the catalog.';

    const { reply } = await generateReply(model, message, productList, recentHistory);

    // Always exactly 2 smart chips — combined with 2 fixed frontend chips = 4 total always.
    const suggestions = pickSmartSuggestions(filters);

    return NextResponse.json({ reply, products, suggestions, filters });
  } catch (error) {
    console.error('Ray error:', error);
    return NextResponse.json(
      { error: 'Ray is a bit busy right now — please try again in a moment.' },
      { status: 500 }
    );
  }
}