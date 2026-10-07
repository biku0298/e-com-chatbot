import { NextRequest, NextResponse } from 'next/server';
import { getChatModel } from '@/lib/ai/gemini';
import { embedQuery } from '@/lib/ai/embeddings';
import { HistoryMessage, Filters } from '@/lib/chat/types';
import { classifyIntent, generateGeneralReply } from '@/lib/chat/intent';
import { handleSizingFlow } from '@/lib/chat/sizing';
import { generatePolicyAnswer, generatePolicySuggestion } from '@/lib/chat/policy';
import { generateReply } from '@/lib/chat/suggestions';
import { searchProducts } from '@/lib/search/productSearch';
import { searchPolicyChunks } from '@/lib/search/policySearch';
import {
  createInitialShoppingState,
  mergeShoppingState,
  toSearchFilters,
  validateAndNormalizeShoppingState,
} from '@/lib/chat/conversationState';
import { decideProductConversation } from '@/lib/chat/conversationDecision';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const { message, history = [], shoppingState: rawIncomingState } = await request.json();

  if (!message || typeof message !== 'string') {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  }

  // Deterministically validate and normalize incoming client state
  const incomingState = validateAndNormalizeShoppingState(rawIncomingState);

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
      const shoppingState = mergeShoppingState(incomingState, { intent: 'general' });
      return NextResponse.json({
        reply: generalReply,
        products: [],
        action: 'general',
        readyForSearch: false,
        suggestions: ['Show tops for boys', 'Dresses for girls', 'Gifts under ₹500'],
        filters: {},
        shoppingState,
      });
    }

    // ── Sizing branch ─────────────────────────────────────────────────────────
    if (intent === 'sizing') {
      const sizingResult = await handleSizingFlow(model, message, recentHistory);

      if (sizingResult.action === 'ask') {
        const shoppingState = mergeShoppingState(incomingState, { intent: 'sizing' });
        // Still gathering info — return just the clarifying question, no products
        return NextResponse.json({
          reply: sizingResult.reply,
          products: [],
          action: 'ask',
          isSizing: true,
          readyForSearch: false,
          suggestions: [],
          filters: {},
          shoppingState,
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
      const shoppingState = mergeShoppingState(incomingState, {
        intent: 'sizing',
        ageMin: sizingResult.ageMin,
        ageMax: sizingResult.ageMax,
        gender: sizingResult.gender as string | null,
      });

      const { suggestions } = await generateReply(
        model,
        message,
        productList,
        recentHistory,
        {
          shoppingState,
          filters: sizeFilters,
          originalQuery: message,
          offset: 0,
          products,
        }
      );

      return NextResponse.json({
        reply: sizingResult.reply,
        products,
        action: 'search',
        isSizing: false, // has products — use product chip set
        readyForSearch: true,
        suggestions,
        filters: sizeFilters,
        shoppingState,
      });
    }

    // ── Policy branch ────────────────────────────────────────────────────────
    if (intent === 'policy') {
      const queryVector = await embedQuery(message);
      const policyChunks = await searchPolicyChunks(queryVector);
      const policyAnswer = await generatePolicyAnswer(model, message, policyChunks, recentHistory);
      // Generate one context-aware follow-up suggestion in parallel (non-blocking on answer)
      const policySuggestion = await generatePolicySuggestion(model, policyAnswer);

      const shoppingState = mergeShoppingState(incomingState, { intent: 'policy' });

      return NextResponse.json({
        reply: policyAnswer,
        products: [],
        action: 'policy',
        isPolicy: true,
        readyForSearch: false,
        suggestions: [policySuggestion],
        filters: {},
        shoppingState,
      });
    }

    // ── Product branch (Conversational Decision Engine) ───────────────────────
    const decision = await decideProductConversation(model, message, recentHistory, incomingState);

    // If Ray needs more info, ask ONE natural question without querying products
    if (decision.action === 'ask') {
      return NextResponse.json({
        reply: decision.reply,
        products: [],
        action: 'ask',
        readyForSearch: false,
        suggestions: decision.suggestions ?? [],
        filters: toSearchFilters(decision.updatedState),
        shoppingState: decision.updatedState,
      });
    }

    // Mandatory criteria met -> execute product search
    const searchFilters = toSearchFilters(decision.updatedState);
    const searchQuery = [
      decision.updatedState.color,
      decision.updatedState.occasion,
      decision.updatedState.type,
      decision.updatedState.category,
      message,
    ]
      .filter(Boolean)
      .join(' ');

    const queryVector = await embedQuery(searchQuery);
    const products = await searchProducts(searchFilters, queryVector);

    const productList = products.length
      ? products.map((p) => `- ${p.name} (${p.color}, ${p.size}) — ₹${p.price}`).join('\n')
      : 'No matching products found in the catalog.';

    const { reply, suggestions } = await generateReply(
      model,
      message,
      productList,
      recentHistory,
      {
        shoppingState: decision.updatedState,
        filters: searchFilters,
        originalQuery: searchQuery,
        offset: 0,
        products,
      }
    );

    return NextResponse.json({
      reply,
      products,
      action: 'search',
      readyForSearch: true,
      suggestions,
      filters: searchFilters,
      shoppingState: decision.updatedState,
      searchQuery,
    });

  } catch (error) {
    console.error('Ray error:', error);
    return NextResponse.json(
      { error: 'Ray is a bit busy right now — please try again in a moment.' },
      { status: 500 }
    );
  }
}