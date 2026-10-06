This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Architecture

- **UI** (`components/chat/ChatWidget.tsx`): Interactive client-side chat interface with voice input, loading states, product cards, and suggestion chips.
- **API** (`app/api/chat/route.ts`, `app/api/chat/more/route.ts`): Serverless route handlers orchestrating domain flows, pagination, and JSON responses.
- **Chat Logic** (`lib/chat/`): Intent classification (`intent.ts`), filter extraction and sanitization (`filters.ts`), size guidance (`sizing.ts`), policy RAG prompts (`policy.ts`), suggestion generation (`suggestions.ts`), and conversation history formatting (`history.ts`).
- **AI Layer** (`lib/ai/`): Google Generative AI client initialization, model access, and retry handling (`gemini.ts`), alongside text embeddings generation with `gemini-embedding-001` (`embeddings.ts`).
- **Search Layer** (`lib/search/`): Hybrid structured filtering + pgvector similarity queries for products (`productSearch.ts`) and cosine similarity policy chunk retrieval (`policySearch.ts`).
- **PostgreSQL / pgvector** (`lib/db.ts`): Shared connection pool executing raw SQL vector operations via pgvector.

