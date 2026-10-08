import type { Filters, ProductSearchResult, PolicyChunkSearchResult } from '../chat/types';
import type { classifyIntent } from '../chat/intent';
import type { generateGeneralReply } from '../chat/intent';
import type { handleSizingFlow } from '../chat/sizing';
import type { generatePolicyResponse } from '../chat/policy';
import type { generateReply } from '../chat/suggestions';
import type { generateContextualSuggestions } from '../chat/suggestions';
import type { decideProductConversation } from '../chat/conversationDecision';

type WithoutModel<T> = T extends (model: any, ...args: infer A) => infer R ? (...args: A) => R : never;

/** All external operations needed by the stateless conversation engine. */
export interface AssistantDependencies {
  classifyIntent: WithoutModel<typeof classifyIntent>;
  generateGeneralReply: WithoutModel<typeof generateGeneralReply>;
  handleSizingFlow: WithoutModel<typeof handleSizingFlow>;
  generatePolicyResponse: WithoutModel<typeof generatePolicyResponse>;
  generateReply: WithoutModel<typeof generateReply>;
  generateContextualSuggestions: WithoutModel<typeof generateContextualSuggestions>;
  decideProductConversation: WithoutModel<typeof decideProductConversation>;
  searchProducts(filters: Filters, query: string, skip?: number, take?: number): Promise<ProductSearchResult[]>;
  searchPolicyChunks(query: string): Promise<PolicyChunkSearchResult[]>;
}
