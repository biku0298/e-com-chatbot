# Bachpankart shopping assistant

A conversational shopping assistant built with Next.js, React, Gemini and PostgreSQL/pgvector. The demo catalog is replaceable; the conversation engine owns intent routing, clarification, shopping state, sizing, policy answers and contextual suggestions.

## Run locally

Install dependencies with npm install. Set GEMINI_API_KEY and DATABASE_URL in .env.local, provision the existing Prisma schema and embeddings, then run npm run dev. Existing seeding and embedding tools are in prisma/. API keys and database credentials belong on the server.

## Architecture

React UI → HTTP routes → assistant engine → AI and search adapters

- lib/assistant/engine.ts: stateless orchestration with injected dependencies; no Next.js, Gemini SDK, SQL, or database runtime imports.
- lib/assistant/contracts.ts: typed AI operations and backend-neutral search contracts. Search receives text and filters; embedding and database choices stay inside adapters.
- lib/assistant/runtime.ts: composition root wiring the current Gemini and PostgreSQL implementations.
- lib/assistant/input.ts: shared input validation and history limits, including when calling the engine directly.
- lib/chat/: conversation prompts, state normalization, sizing and suggestions.
- lib/ai/: Gemini client and embeddings. Identical query embeddings are shared for five minutes in a bounded 128-entry process-local cache, including concurrent calls. Failures are evicted.
- lib/search/: current SQL/pgvector adapters.
- app/api/chat/: thin HTTP transport with JSON parsing and error mapping.
- components/chat/ChatWidget.tsx: demo React interface consuming the JSON API.

## Integrate with another backend or UI

Keep the current conversation operations and replace searchProducts and searchPolicyChunks in lib/assistant/runtime.ts. The product adapter accepts (filters, query, skip, take) and returns ProductSearchResult[]. The policy adapter accepts a query and returns PolicyChunkSearchResult[]. Another backend may implement semantic search itself, use its own embeddings, or use structured search without vectors. No embeddings or SQL are required by the engine contract.

For a different server, construct createAssistant(dependencies) and call assistant.chat(body) or assistant.more(body). Import the engine directly rather than the default runtime to avoid loading the demo database. InputError should map to HTTP 400; other failures to a generic server error. The factory does not store user sessions or conversation state.

For a different UI, send these JSON bodies:

- POST /api/chat: { message, history?, shoppingState? }
- POST /api/chat/more: { filters?, originalQuery?, skip?, history?, shoppingState? }

Preserve shoppingState from each response and send it on the next turn. Product-search responses include searchQuery; pass this as originalQuery for pagination. Render reply, products and suggestions independently. The chat action is ask, search, policy or general; readyForSearch indicates whether a search ran. Pagination responses retain the existing products, suggestions, shoppingState and reply fields.

Messages and original queries are limited to 2,000 characters. Only the last six history messages are used, each limited to 2,000 characters. Invalid bodies, history, filter types and offsets return 400. The engine preserves the existing conversational decisions and Gemini suggestions, including on every Show More batch.

Store branding lives in lib/config.ts. The existing clothing taxonomy and size reference remain in lib/chat/conversationState.ts and lib/chat/sizing.ts: adapt these if the production catalog uses different categories or sizing conventions. ProductSearchResult currently uses numeric IDs; map external IDs to this contract or update the shared type and consumer together.

## Performance and verification

Embedding reuse saves an external call on repeated queries and pagination within a warm process. The cache is opportunistic: cold starts and separate server instances compute their own vectors. Replies and product results are never cached. Gemini model instances are reused. Vector ordering uses product ID as a tie breaker; offset pagination can still shift when catalog contents change.

Run npm run test:assistant for offline tests covering every intent branch, clarification without search, backend substitution, pagination context, input validation, and cache coalescing/expiry/eviction/failure recovery. Run npm run lint and npm run build for static and production checks. These tests do not call Gemini or a live database; scripts/test_live_*.ts provide existing live scenarios when configured.

## Conversation rules and cleanup

Search readiness now comes from one missing-field rule: type/category, gender and age must be known or explicitly irrelevant. Once those requirements are met, an optional Gemini question cannot delay search. The decision prompt requests only extracted updates, a question, and suggestion chips; unused model reasoning and duplicate understanding fields have been removed. State merging owns normalization.

Intent classification receives the current shopping state so an age reply continues the active shopping or sizing flow. The offline fallback only accepts explicit age expressions or a bare age in response to an age question; prices and quantities no longer supply ages.

Initial results and pagination share suggestion rules but each batch still gets a fresh Gemini call. Policy answers and their follow-up now use one generatePolicyResponse adapter operation, replacing generatePolicyAnswer plus generatePolicySuggestion. Adapters should return { reply, suggestions }.

The test:assistant command includes both engine tests and direct conversation regression tests with simulated Gemini outputs and failures. These verify behavior deterministically without live API or database calls.
