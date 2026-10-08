import type { AssistantDependencies } from './contracts';
import type { Filters } from '../chat/types';
import { mergeShoppingState, toSearchFilters, validateAndNormalizeShoppingState } from '../chat/conversationState';
import { sanitizeFilters } from '../chat/filters';
import { parseChatInput, parseMoreInput } from './input';

/** No Next.js, database, embedding, or provider runtime imports. State belongs to the caller. */
export function createAssistant(dependencies: AssistantDependencies) {
  const { classifyIntent, generateGeneralReply, handleSizingFlow, generatePolicyResponse, generateReply, generateContextualSuggestions, decideProductConversation, searchProducts, searchPolicyChunks } = dependencies;
  async function chat(rawInput: unknown) {
    const { message, history: recentHistory, shoppingState: rawIncomingState } = parseChatInput(rawInput);
    const incomingState = validateAndNormalizeShoppingState(rawIncomingState);
    // Step 1: classify intent first (keyword heuristic is instant for most messages)
    const intent = await classifyIntent(message, recentHistory, incomingState);

    // ── General branch (greetings / small talk) ────────────────────────────
    // No embedding, no DB query — just a quick conversational reply
    if (intent === 'general') {
      const generalReply = await generateGeneralReply(message, recentHistory);
      const shoppingState = mergeShoppingState(incomingState, { intent: 'general' });
      return {
        reply: generalReply,
        products: [],
        action: 'general',
        readyForSearch: false,
        suggestions: ['Show tops for boys', 'Dresses for girls', 'Gifts under ₹500'],
        filters: {},
        shoppingState,
      };
    }

    // ── Sizing branch ─────────────────────────────────────────────────────────
    if (intent === 'sizing') {
      const sizingResult = await handleSizingFlow(message, recentHistory);

      if (sizingResult.action === 'ask') {
        const shoppingState = mergeShoppingState(incomingState, { intent: 'sizing' });
        // Still gathering info — return just the clarifying question, no products
        return {
          reply: sizingResult.reply,
          products: [],
          action: 'ask',
          isSizing: true,
          readyForSearch: false,
          suggestions: [],
          filters: {},
          shoppingState,
        };
      }

      // action === 'recommend' — run product search with the determined age range
      const sizeFilters: Filters = {
        ageMin: sizingResult.ageMin,
        ageMax: sizingResult.ageMax,
        gender: sizingResult.gender as string | null,
      };
      const products = await searchProducts(sizeFilters, message);
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

      return {
        reply: sizingResult.reply,
        products,
        action: 'search',
        isSizing: false, // has products — use product chip set
        readyForSearch: true,
        suggestions,
        filters: sizeFilters,
        shoppingState,
      };
    }

    // ── Policy branch ────────────────────────────────────────────────────────
    if (intent === 'policy') {
      const policyChunks = await searchPolicyChunks(message);
      const policyResponse = await generatePolicyResponse(message, policyChunks, recentHistory);

      const shoppingState = mergeShoppingState(incomingState, { intent: 'policy' });

      return {
        reply: policyResponse.reply,
        products: [],
        action: 'policy',
        isPolicy: true,
        readyForSearch: false,
        suggestions: policyResponse.suggestions,
        filters: {},
        shoppingState,
      };
    }

    // ── Product branch (Conversational Decision Engine) ───────────────────────
    const decision = await decideProductConversation(message, recentHistory, incomingState);

    // If Ray needs more info, ask ONE natural question without querying products
    if (decision.action === 'ask') {
      return {
        reply: decision.reply,
        products: [],
        action: 'ask',
        readyForSearch: false,
        suggestions: decision.suggestions ?? [],
        filters: toSearchFilters(decision.updatedState),
        shoppingState: decision.updatedState,
      };
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

    const products = await searchProducts(searchFilters, searchQuery);

    const productList = products.length
      ? products.map((p) => `- ${p.name} (${p.color}, ${p.size}) — ₹${p.price}`).join('\n')
      : 'No matching products found in the catalog.';

    const { reply, suggestions } = await generateReply(
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

    return {
      reply,
      products,
      action: 'search',
      readyForSearch: true,
      suggestions,
      filters: searchFilters,
      shoppingState: decision.updatedState,
      searchQuery,
    };

  }

  async function more(rawInput: unknown) {
    const { filters: rawFilters, skip, originalQuery, shoppingState: rawState, history } = parseMoreInput(rawInput);
    const filters = sanitizeFilters(rawFilters);
    const shoppingState = validateAndNormalizeShoppingState(rawState);
    const products = await searchProducts(filters, originalQuery, skip, 6);
    const suggestions = await generateContextualSuggestions(history, { shoppingState, filters, originalQuery, offset: skip, products });
    return { products, suggestions, shoppingState, reply: products.length ? 'Here are some more options ✨' : "That's all we have matching those filters!" };
  }
  return { chat, more };
}
