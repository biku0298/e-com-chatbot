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
import { ensureTaxonomy } from '../catalog/bkTaxonomyStore';

/**
 * Composition root. Products come live from the bachpankart API; the store hierarchy comes from
 * our database copy (refreshed from the API every few hours); policy answers use the database too.
 */
const engine = createAssistant({
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

/** Each turn first makes sure the store hierarchy is loaded and not too old (instant when fresh). */
export const assistant = {
  async chat(input: unknown) {
    await ensureTaxonomy();
    return engine.chat(input);
  },
  async more(input: unknown) {
    await ensureTaxonomy();
    return engine.more(input);
  },
};
