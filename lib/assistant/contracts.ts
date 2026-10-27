import type { ConversationDecision, Filters, HistoryMessage, ProductSearchResult, PolicyChunkSearchResult, ShoppingState } from '../chat/types';
import type { classifyIntent, generateGeneralReply } from '../chat/intent';
import type { handleSizingFlow } from '../chat/sizing';
import type { generatePolicyResponse } from '../chat/policy';
import type { generateReply } from '../chat/suggestions';
import type { Catalog } from '../catalog/types';

type WithoutModel<T> = T extends (model: any, ...args: infer A) => infer R ? (...args: A) => R : never;

/** All external operations needed by the stateless conversation engine. */
export interface AssistantDependencies {
  classifyIntent: WithoutModel<typeof classifyIntent>;
  generateGeneralReply: WithoutModel<typeof generateGeneralReply>;
  handleSizingFlow: WithoutModel<typeof handleSizingFlow>;
  generatePolicyResponse: WithoutModel<typeof generatePolicyResponse>;
  generateReply: WithoutModel<typeof generateReply>;
  /** The runtime binds the model and the catalog. */
  decideProductConversation(message: string, history: HistoryMessage[], state: ShoppingState): Promise<ConversationDecision>;
  searchProducts(filters: Filters, query: string, skip?: number, take?: number): Promise<ProductSearchResult[]>;
  searchPolicyChunks(query: string): Promise<PolicyChunkSearchResult[]>;
  /** Catalog rules (required fields, word mapping, chips, wording). */
  catalog: Catalog;
}
