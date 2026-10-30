# Ray: the Bachpankart shopping assistant

Ray is a chat assistant for [Bachpankart](https://bachpankart.com), a store for kids' clothes, toys, footwear, books and baby care. Shoppers describe what they want in their own words ("a party dress for my 5 year old daughter"). Ray asks only the questions it still needs, shows matching products straight from the live store, and helps narrow them down with one-tap suggestion chips.

## What Ray does

- **Asks questions in the store's own order:** department, then the kind of item, then who it is for, then age. It skips anything the shopper already said, and never asks boy-or-girl for things that are mostly unisex, such as footwear and school supplies.
- **Shows live products only:** every product, price and stock level comes from the Bachpankart API at the moment of the search. Ray never invents products or falls back to unrelated ones.
- **Builds suggestion chips from real results:** chips like *Party wear* or *In blue* come from the products and filter counts the store just returned, so tapping one always leads to products. Ray never shows price chips.
- **Shows full product details in the chat:** tapping a product card opens a popup with photos, colours, sizes, price, details and description, plus a Back button to return to the conversation.
- **Answers store policy questions** (returns, shipping, exchanges) from the store's policy text, using vector search.
- **Helps with sizing** by turning height or age into the right size range.
- **Takes voice input** in browsers that support speech recognition.

## Tech stack

| Area | Technology | What it is used for |
|---|---|---|
| Framework | [Next.js 16](https://nextjs.org) (App Router, route handlers) | The chat page and the API routes (`/api/chat`, `/api/chat/more`, `/api/chat/product/{slug}/{id}`) |
| UI | React 19, CSS Modules, Nunito font via `next/font` | The chat widget, product cards and product popup |
| Language | TypeScript | All app, script and test code |
| AI | Google Gemini via `@google/generative-ai` | `gemini-flash-lite-latest` reads the shopper's message and writes short replies. `gemini-embedding-001` turns policy text into vectors. |
| Database | PostgreSQL (hosted on [Neon](https://neon.tech)) with the `pgvector` extension | A copy of the store hierarchy (departments → categories → product types), and policy text with its embeddings |
| ORM | [Prisma 7](https://www.prisma.io) with `@prisma/adapter-pg` and `pg` | Schema, table setup and the hierarchy sync |
| Product data | Bachpankart consumer API (`api.bachpankart.com/api/consumer/`) | Live product search, filter counts (facets), single product pages and the store menu |
| Voice | Web Speech API (built into the browser) | Voice input in the chat box |
| Tests | Node's `assert` module, run with [tsx](https://tsx.is) | Fast offline tests against recorded API responses |
| Linting | ESLint 9 with `eslint-config-next` | Code checks |

## How it works

```
Browser (chat widget)
   │  POST /api/chat
   ▼
Assistant engine (lib/assistant/engine.ts)
   ├─ What kind of message is this?   product · policy · sizing · small talk   (Gemini)
   ├─ What does the shopper want?     item, who, age, colour, budget…          (Gemini)
   ├─ What is still missing?          asked in the store's hierarchy order     (no AI)
   └─ Search                          products + filter counts, in parallel    (Bachpankart API)
         └─ chips from the returned products, then a short reply                (Gemini)
```

- **Store hierarchy:** the department → category → product type tree is copied from the store's `/menu` endpoint into Postgres every 5 hours, re-read from Postgres every 5 hours, and backed by a bundled snapshot if the database is unreachable. Products themselves are never copied; they are always searched live.
- **API client:** every call to the store goes through one client (`lib/bk/client.ts`) that caches answers for 10 minutes, retries failures and, during development, spaces requests out.
- **Engine:** the engine (`lib/assistant/engine.ts`) has no database, network or AI imports of its own. Everything it uses is passed in from `lib/assistant/runtime.ts`, so tests can swap in fakes.

## Project structure

```
app/                     Next.js page and API routes
components/chat/         Chat widget, message list, product popup, hooks
lib/assistant/           The engine, its inputs and the runtime that wires it up
lib/chat/                Conversation state, intent, questions, replies, policy, sizing
lib/catalog/             Store rules: hierarchy, word mapping, which questions to ask
lib/search/              Product search, product details, policy search
lib/bk/                  The Bachpankart API client
lib/ai/                  Gemini model and embeddings
lib/client/              Browser-side chat API and conversation state
prisma/                  Database schema, policy text and the policy embedding script
scripts/                 Tests, store hierarchy sync and API tools
fixtures/bk/             Recorded Bachpankart API responses used by the tests
```

## Getting started

**Requirements:** Node.js 20.9 or newer (developed on Node 24), a PostgreSQL database with the `pgvector` extension available (Neon has it), and a [Gemini API key](https://aistudio.google.com/apikey).

```bash
npm install
cp .env.example .env          # then fill in DATABASE_URL and GEMINI_API_KEY
npx prisma db push            # create the tables
npm run sync:bk               # copy the store hierarchy (also happens automatically)
npx tsx prisma/embed-policy.ts  # load the policy text for policy answers
npm run dev                   # http://localhost:3000
```

### Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Yes | | Postgres connection string |
| `GEMINI_API_KEY` | Yes | | Google Gemini API key |
| `GEMINI_CHAT_MODEL` | No | `gemini-flash-lite-latest` | Model for understanding messages and writing replies |
| `GEMINI_EMBEDDING_MODEL` | No | `gemini-embedding-001` | Model for policy embeddings |
| `BK_API_BASE_URL` | No | `https://api.bachpankart.com/api/consumer/` | Bachpankart API address |
| `BK_SITE_URL` | No | `https://bachpankart.com` | Store website address |
| `BK_SYNC_INTERVAL_HOURS` | No | `5` | How often the store hierarchy is re-copied |
| `BK_RATE_LIMIT` | No | on outside production | Development request budget: at most 1 request per second, stop at 300 per hour |

Never commit `.env`; it is already in `.gitignore`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Generate the Prisma client and build for production |
| `npm start` | Run the production build |
| `npm run lint` | Run ESLint |
| `npm run test:assistant` | Run all tests (offline, see below) |
| `npm run sync:bk` | Copy the store hierarchy from `/menu` into the database now |
| `npm run try:bk -- "message" "next message"` | Run a conversation against the live API and Gemini in the terminal |
| `npm run discover:bk` | Record fresh API responses into `fixtures/bk/` (makes real requests) |

## Tests

```bash
npm run test:assistant
```

The tests never call the live Bachpankart API or Gemini. They replay the recorded responses in `fixtures/bk/` and use fake AI models, so they are fast, free and give the same result every time. They cover the conversation engine, chat rules, the browser client, the API client (caching, retries, rate limits), store rules, product search, the product popup, full conversations and the hierarchy sync.

To refresh the recordings after the store changes, run `npm run discover:bk -- --refresh`. Use `--offline` to rebuild the summary from the saved files without any requests.
