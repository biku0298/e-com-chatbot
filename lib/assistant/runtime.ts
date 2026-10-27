import { getChatModel } from '../ai/gemini';
import { embedQuery } from '../ai/embeddings';
import { searchProducts } from '../search/productSearch';
import { createBkLiveSearch } from '../search/bkLiveSearch';
import { searchPolicyChunks } from '../search/policySearch';
import { createAssistant } from './engine';
import { classifyIntent, generateGeneralReply } from '../chat/intent';
import { handleSizingFlow } from '../chat/sizing';
import { generatePolicyResponse } from '../chat/policy';
import { generateReply } from '../chat/suggestions';
import { decideProductConversation } from '../chat/conversationDecision';
import { fakeCatalog } from '../catalog/fakeCatalog';
import { bkCatalog } from '../catalog/bkCatalog';
import type { AssistantDependencies } from './contracts';

/**
 * Where products come from: `fake` (local Postgres, 1000 generated products; the default) or
 * `bk_live` (the live bachpankart API). Policy answers use the local database either way.
 */
export const CATALOG_SOURCE = process.env.CATALOG_SOURCE === 'bk_live' ? 'bk_live' : 'fake';

const catalog = CATALOG_SOURCE === 'bk_live' ? bkCatalog : fakeCatalog;
const databaseSearch: AssistantDependencies['searchProducts'] = async (filters, query, skip, take) =>
  searchProducts(filters, query ? await embedQuery(query) : null, skip, take);

/** Composition root: replace these search adapters to connect another backend. */
export const assistant = createAssistant({
  catalog,
  classifyIntent: (message, history, state) => classifyIntent(getChatModel(), message, history, state, catalog.isProductMessage),
  generateGeneralReply: (...args) => generateGeneralReply(getChatModel(), ...args),
  handleSizingFlow: (...args) => handleSizingFlow(getChatModel(), ...args),
  generatePolicyResponse: (...args) => generatePolicyResponse(getChatModel(), ...args),
  generateReply: (...args) => generateReply(getChatModel(), ...args),
  decideProductConversation: (message, history, state) => decideProductConversation(getChatModel(), message, history, state, catalog),
  searchProducts: CATALOG_SOURCE === 'bk_live' ? createBkLiveSearch() : databaseSearch,
  searchPolicyChunks: async (query) => searchPolicyChunks(await embedQuery(query)),
});
