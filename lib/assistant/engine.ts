import type { AssistantDependencies } from './contracts';
import type { ChatResponse, MoreResponse, Filters, HistoryMessage, ShoppingState, Suggestion } from '../chat/types';
import { canSearch, mergeShoppingState, toSearchFilters, validateAndNormalizeShoppingState } from '../chat/conversationState';
import { sanitizeFilters } from '../chat/filters';
import { buildFunnelChips, buildRemoveChips, describeFilters, templateReply } from '../chat/suggestions';
import { PAGE_SIZE } from '../config';
import { parseChatInput, parseMoreInput } from './input';

const GENERAL_SUGGESTIONS = ['Shop for a boy 👦', 'Shop for a girl 👧', 'Party wear 🎉'];
const textChips = (labels: string[]): Suggestion[] => labels.map(label => ({ label }));

function sameFilters(a: Filters, b: Filters): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof Filters)[]);
  return [...keys].every(key => (a[key] ?? null) === (b[key] ?? null));
}

/**
 * Refinement chips are only safe when a chip click re-runs exactly the search that produced
 * these products plus one filter. That holds when the state is search-ready and its filters
 * are the ones this batch was fetched with.
 */
function funnelChipsFor(state: ShoppingState, searchedWith: Filters, products: MoreResponse['products']) {
  return canSearch(state) && sameFilters(searchedWith, toSearchFilters(state))
    ? buildFunnelChips(state, products)
    : { chips: [], nextRefinement: null };
}

/** No Next.js, database, embedding, or provider runtime imports. State belongs to the caller. */
export function createAssistant(dependencies: AssistantDependencies) {
  const { classifyIntent, generateGeneralReply, handleSizingFlow, generatePolicyResponse, generateReply, decideProductConversation, searchProducts, searchPolicyChunks } = dependencies;

  /** One search, no relaxation. Chips come from the returned batch only. Chip labels stay out of the embedding query. */
  async function searchAndRespond(state: ShoppingState, message: string, history: HistoryMessage[], isChip = false): Promise<ChatResponse> {
    const filters = toSearchFilters(state);
    const searchQuery = [state.color, state.occasion, state.type, state.category, isChip ? null : message]
      .filter(Boolean)
      .join(' ');
    const products = await searchProducts(filters, searchQuery, 0, PAGE_SIZE);
    const base = { products, action: 'search' as const, readyForSearch: true, filters, shoppingState: state, searchQuery };

    if (products.length === 0) {
      const suggestions = buildRemoveChips(state);
      const reply = `I couldn't find ${describeFilters(state)} right now.` +
        (suggestions.length ? ' Would you like to drop one of these preferences?' : '');
      return { ...base, reply, suggestions, nextRefinement: null, hasMore: false };
    }

    const { chips, nextRefinement } = funnelChipsFor(state, filters, products);
    const { reply } = await generateReply(
      message,
      history,
      { shoppingState: state, filters, originalQuery: searchQuery, offset: 0, products },
      { nextRefinement, labels: chips.map(chip => chip.label) }
    );
    return { ...base, reply, suggestions: chips, nextRefinement, hasMore: products.length === PAGE_SIZE };
  }

  async function chat(rawInput: unknown): Promise<ChatResponse> {
    const { message, history: recentHistory, shoppingState: rawIncomingState, refine, remove } = parseChatInput(rawInput);
    const incomingState = validateAndNormalizeShoppingState(rawIncomingState);

    // ── Chip refinement: the state is already search-ready, so skip intent and extraction ──
    if ((refine || remove) && canSearch(incomingState)) {
      let state = mergeShoppingState(incomingState, { ...refine, intent: 'product' });
      for (const field of remove ?? []) {
        state = mergeShoppingState({ ...state, [field]: null }, { unimportantFields: [field] });
      }
      return searchAndRespond(state, message, recentHistory, true);
    }

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
        suggestions: textChips(GENERAL_SUGGESTIONS),
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
      const products = await searchProducts(sizeFilters, message, 0, PAGE_SIZE);
      const shoppingState = mergeShoppingState(incomingState, {
        intent: 'sizing',
        ageMin: sizingResult.ageMin,
        ageMax: sizingResult.ageMax,
        gender: sizingResult.gender as string | null,
      });
      const { chips, nextRefinement } = funnelChipsFor(shoppingState, sizeFilters, products);

      return {
        reply: sizingResult.reply,
        products,
        action: 'search',
        isSizing: false, // has products — use product chip set
        readyForSearch: true,
        suggestions: chips,
        nextRefinement,
        hasMore: products.length === PAGE_SIZE,
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
        suggestions: textChips(policyResponse.suggestions),
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
        suggestions: textChips(decision.suggestions ?? []),
        filters: toSearchFilters(decision.updatedState),
        shoppingState: decision.updatedState,
      };
    }

    // Mandatory criteria met -> execute product search
    return searchAndRespond(decision.updatedState, message, recentHistory);
  }

  /** Pagination makes no model calls: template reply plus chips from the new batch. */
  async function more(rawInput: unknown): Promise<MoreResponse> {
    const { filters: rawFilters, skip, originalQuery, shoppingState: rawState } = parseMoreInput(rawInput);
    const filters = sanitizeFilters(rawFilters);
    const shoppingState = validateAndNormalizeShoppingState(rawState);
    const products = await searchProducts(filters, originalQuery, skip, PAGE_SIZE);
    const { chips, nextRefinement } = funnelChipsFor(shoppingState, filters, products);
    return {
      products,
      suggestions: chips,
      nextRefinement,
      hasMore: products.length === PAGE_SIZE,
      shoppingState,
      reply: products.length
        ? templateReply('Here are some more options ✨', { nextRefinement, labels: chips.map(chip => chip.label) })
        : "That's all we have matching those filters!",
    };
  }
  return { chat, more };
}
