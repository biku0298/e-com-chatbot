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
