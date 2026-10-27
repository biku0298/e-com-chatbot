import { getChatModel } from '../ai/gemini';
import { embedQuery } from '../ai/embeddings';
import { createBkFacetSearch, createBkLiveSearch } from '../search/bkLiveSearch';
import { searchPolicyChunks } from '../search/policySearch';
import { createAssistant } from './engine';
import { classifyIntent, generateGeneralReply } from '../chat/intent';
import { handleSizingFlow } from '../chat/sizing';
import { generatePolicyResponse } from '../chat/policy';
import { generateReply } from '../chat/suggestions';
import { decideProductConversation } from '../chat/conversationDecision';
import { bkCatalog } from '../catalog/bkCatalog';

/**
 * Composition root. Products come live from the bachpankart API; policy answers still use the
 * local database (policy chunks + embeddings).
 */
export const assistant = createAssistant({
  catalog: bkCatalog,
  classifyIntent: (message, history, state) => classifyIntent(getChatModel(), message, history, state, bkCatalog.isProductMessage),
  generateGeneralReply: (...args) => generateGeneralReply(getChatModel(), ...args),
  handleSizingFlow: (...args) => handleSizingFlow(getChatModel(), ...args),
  generatePolicyResponse: (...args) => generatePolicyResponse(getChatModel(), ...args),
  generateReply: (...args) => generateReply(getChatModel(), ...args),
  decideProductConversation: (message, history, state) => decideProductConversation(getChatModel(), message, history, state, bkCatalog),
  searchProducts: createBkLiveSearch(),
  searchFacets: createBkFacetSearch(),
  searchPolicyChunks: async (query) => searchPolicyChunks(await embedQuery(query)),
});
