import { getChatModel } from '../ai/gemini';
import { embedQuery } from '../ai/embeddings';
import { searchProducts } from '../search/productSearch';
import { searchPolicyChunks } from '../search/policySearch';
import { createAssistant } from './engine';
import { classifyIntent } from '../chat/intent';
import { generateGeneralReply } from '../chat/intent';
import { handleSizingFlow } from '../chat/sizing';
import { generatePolicyResponse } from '../chat/policy';
import { generateReply } from '../chat/suggestions';
import { generateContextualSuggestions } from '../chat/suggestions';
import { decideProductConversation } from '../chat/conversationDecision';

/** Composition root: replace these search adapters to connect another backend. */
export const assistant = createAssistant({
  classifyIntent: (...args) => classifyIntent(getChatModel(), ...args),
  generateGeneralReply: (...args) => generateGeneralReply(getChatModel(), ...args),
  handleSizingFlow: (...args) => handleSizingFlow(getChatModel(), ...args),
  generatePolicyResponse: (...args) => generatePolicyResponse(getChatModel(), ...args),
  generateReply: (...args) => generateReply(getChatModel(), ...args),
  generateContextualSuggestions: (...args) => generateContextualSuggestions(getChatModel(), ...args),
  decideProductConversation: (...args) => decideProductConversation(getChatModel(), ...args),
  searchProducts: async (filters, query, skip, take) => searchProducts(filters, query ? await embedQuery(query) : null, skip, take),
  searchPolicyChunks: async (query) => searchPolicyChunks(await embedQuery(query)),
});
