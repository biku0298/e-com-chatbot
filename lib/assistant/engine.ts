import type { AssistantDependencies } from './contracts';
import type { ChatResponse, FacetCounts, MoreResponse, Filters, HistoryMessage, ShoppingState, Suggestion } from '../chat/types';
import { mergeShoppingState, toSearchFilters, validateAndNormalizeShoppingState } from '../chat/conversationState';
import { sanitizeFilters } from '../chat/filters';
import { templateReply } from '../chat/funnel';
import { CatalogUnavailableError } from '../catalog/errors';
import { CHIP_SAMPLE_SIZE, PAGE_SIZE } from '../config';
import { parseChatInput, parseMoreInput } from './input';

const GENERAL_SUGGESTIONS = ['Shop for a boy 👦', 'Shop for a girl 👧', 'Party wear 🎉'];
const textChips = (labels: string[]): Suggestion[] => labels.map(label => ({ label }));
/** Shown when the product catalog cannot be reached. Never replaced by fake products. */
export const CATALOG_UNAVAILABLE_REPLY = "I can't reach the store's catalog right now 😕 Please try again in a moment.";

function sameFilters(a: Filters, b: Filters): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof Filters)[]);
  return [...keys].every(key => (a[key] ?? null) === (b[key] ?? null));
}

/** No Next.js, database, embedding, or provider runtime imports. State belongs to the caller. */
export function createAssistant(dependencies: AssistantDependencies) {
  const { classifyIntent, generateGeneralReply, handleSizingFlow, generatePolicyResponse, generateReply, decideProductConversation, searchProducts, searchFacets, searchPolicyChunks } = dependencies;
  const { catalog } = dependencies;
  const isReady = (state: ShoppingState) => catalog.missingFields(state).length === 0;

  /**
   * Refinement chips are only safe when a chip click re-runs exactly the search that produced
   * these products plus one filter. That holds when the state is search-ready and its filters
   * are the ones this batch was fetched with.
   */
  function funnelChipsFor(state: ShoppingState, searchedWith: Filters, sample: MoreResponse['products'], facets: FacetCounts | null) {
    return isReady(state) && sameFilters(searchedWith, toSearchFilters(state))
      ? catalog.buildChips(state, sample, { complete: sample.length < CHIP_SAMPLE_SIZE, facets })
      : { chips: [], nextRefinement: null };
  }

  /**
   * One query per batch: shows PAGE_SIZE rows, and the extra rows reveal whether another page
   * exists and widen the sample chips are built from. Every sampled row matched the filters,
   * so a chip built from any of them still leads to at least one product.
   */
  async function fetchBatch(filters: Filters, query: string, skip: number) {
    // Filter counts travel alongside the products; losing them only means fewer kinds of chips.
    const [sample, facets] = await Promise.all([
      searchProducts(filters, query, skip, CHIP_SAMPLE_SIZE),
      searchFacets ? searchFacets(filters).catch(() => null) : Promise.resolve(null),
    ]);
    return { products: sample.slice(0, PAGE_SIZE), sample, hasMore: sample.length > PAGE_SIZE, facets };
  }

  /** The catalog is down: say so, with no products and no chips. Other errors still propagate. */
  function unavailable<T extends MoreResponse>(error: unknown, response: Omit<T, 'reply' | 'products' | 'suggestions'>): T {
    if (!(error instanceof CatalogUnavailableError)) throw error;
    return { ...response, reply: CATALOG_UNAVAILABLE_REPLY, products: [], suggestions: [], nextRefinement: null, hasMore: false } as unknown as T;
  }

  /** One search, no relaxation. Chips come from the returned batch only. Chip labels stay out of the embedding query. */
  async function searchAndRespond(state: ShoppingState, message: string, history: HistoryMessage[], isChip = false): Promise<ChatResponse> {
    const filters = toSearchFilters(state);
    const searchQuery = catalog.searchQuery(state, message, isChip);
    let batch: Awaited<ReturnType<typeof fetchBatch>>;
    try {
      batch = await fetchBatch(filters, searchQuery, 0);
    } catch (error) {
      return unavailable<ChatResponse>(error, { action: 'search', readyForSearch: true, filters, shoppingState: state, searchQuery });
    }
    const { products, sample, hasMore, facets } = batch;
    const base = { products, action: 'search' as const, readyForSearch: true, filters, shoppingState: state, searchQuery };

    if (products.length === 0) {
      const suggestions = catalog.removeChips(state);
      const reply = `I couldn't find ${catalog.describe(state)} right now.` +
        (suggestions.length ? ' Would you like to drop one of these preferences?' : '');
      return { ...base, reply, suggestions, nextRefinement: null, hasMore: false };
    }

    const { chips, nextRefinement } = funnelChipsFor(state, filters, sample, facets);
    const { reply } = await generateReply(
      message,
      history,
      { shoppingState: state, filters, originalQuery: searchQuery, offset: 0, products },
      { nextRefinement, labels: chips.map(chip => chip.label) }
    );
    return { ...base, reply, suggestions: chips, nextRefinement, hasMore };
  }

  async function chat(rawInput: unknown): Promise<ChatResponse> {
    const { message, history: recentHistory, shoppingState: rawIncomingState, refine, remove } = parseChatInput(rawInput);
    const incomingState = validateAndNormalizeShoppingState(rawIncomingState);

    // ── Chip refinement: the state is already search-ready, so skip intent and extraction ──
    if ((refine || remove) && isReady(incomingState)) {
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
      const shoppingState = mergeShoppingState(incomingState, {
        intent: 'sizing',
        ageMin: sizingResult.ageMin,
        ageMax: sizingResult.ageMax,
        gender: sizingResult.gender as string | null,
      });
      let batch: Awaited<ReturnType<typeof fetchBatch>>;
      try {
        batch = await fetchBatch(sizeFilters, message, 0);
      } catch (error) {
        return unavailable<ChatResponse>(error, { action: 'search', isSizing: false, readyForSearch: true, filters: sizeFilters, shoppingState });
      }
      const { products, sample, hasMore, facets } = batch;
      const { chips, nextRefinement } = funnelChipsFor(shoppingState, sizeFilters, sample, facets);

      return {
        reply: sizingResult.reply,
        products,
        action: 'search',
        isSizing: false, // has products — use product chip set
        readyForSearch: true,
        suggestions: chips,
        nextRefinement,
        hasMore,
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
    let batch: Awaited<ReturnType<typeof fetchBatch>>;
    try {
      batch = await fetchBatch(filters, originalQuery, skip);
    } catch (error) {
      return unavailable<MoreResponse>(error, { shoppingState });
    }
    const { products, sample, hasMore, facets } = batch;
    const { chips, nextRefinement } = funnelChipsFor(shoppingState, filters, sample, facets);
    return {
      products,
      suggestions: chips,
      nextRefinement,
      hasMore,
      shoppingState,
      reply: products.length
        ? templateReply('Here are some more options ✨', { nextRefinement, labels: chips.map(chip => chip.label) })
        : "That's all we have matching those filters!",
    };
  }
  return { chat, more };
}
