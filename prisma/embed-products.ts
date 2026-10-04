/**
 * embed-products.ts
 * Generates Gemini embedding-001 vectors for all products
 * and writes them back to the DB via raw SQL UPDATE.
 *
 * Run once (or re-run safely — it skips products that already have embeddings):
 *   npx tsx prisma/embed-products.ts
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../app/generated/prisma/client';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pg from 'pg';
import 'dotenv/config';

// ── Clients ───────────────────────────────────────────────────────────────────

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Raw pg pool for the UPDATE (Prisma can't write Unsupported vector columns)
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL!,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  connectionTimeoutMillis: 30000,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
// gemini-embedding-001: available on v1beta, outputs 3072 dims by default
// We truncate to 768 via outputDimensionality to match our vector(768) column
const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a rich search string from product fields */
function buildProductText(p: {
  name: string;
  description: string;
  category: string;
  type: string;
  gender: string;
  color: string;
  fit: string;
  size: string;
  minAge: number;
  maxAge: number;
}): string {
  return [
    p.name,
    p.description,
    `${p.color} ${p.type}`,
    `category: ${p.category}`,
    `for ${p.gender}`,
    `ages ${p.minAge}-${p.maxAge} years`,
    `${p.fit} fit`,
    `size ${p.size}`,
  ].join(' | ');
}

/** Embed a single text string, truncated to 768 dims */
async function embedText(text: string): Promise<number[]> {
  const result = await embeddingModel.embedContent({
    content: { parts: [{ text }], role: 'user' },
    outputDimensionality: 768,
  } as any);
  return result.embedding.values;
}

/** Write a single embedding vector to the DB */
async function saveEmbedding(id: number, vector: number[]): Promise<void> {
  const vectorStr = `[${vector.join(',')}]`;
  await pool.query(
    `UPDATE "Product" SET embedding = $1::vector WHERE id = $2`,
    [vectorStr, id]
  );
}

/** Sleep for ms milliseconds */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Main ──────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 10; // process 10 at a time with small delay between each

async function main() {
  // Only fetch products without embeddings (safe to re-run)
  const products = await prisma.$queryRaw<
    {
      id: number;
      name: string;
      description: string;
      category: string;
      type: string;
      gender: string;
      color: string;
      fit: string;
      size: string;
      minAge: number;
      maxAge: number;
    }[]
  >`SELECT id, name, description, category, type, gender, color, fit, size, "minAge", "maxAge"
    FROM "Product"
    WHERE embedding IS NULL
    ORDER BY id`;

  console.log(`Found ${products.length} products without embeddings.`);
  if (products.length === 0) {
    console.log('All products already have embeddings. Nothing to do.');
    return;
  }

  let done = 0;
  let errors = 0;

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);

    // Embed each product in the batch sequentially (avoids burst rate limits)
    for (const product of batch) {
      try {
        const text = buildProductText(product);
        const vector = await embedText(text);
        await saveEmbedding(product.id, vector);
        done++;

        // Small pause between individual calls
        await sleep(100);
      } catch (err: any) {
        errors++;
        console.error(`✗ Failed product id=${product.id}:`, err?.message ?? err);
        await sleep(500); // longer pause after error
      }
    }

    console.log(`✔ ${done}/${products.length} embeddings saved (${errors} errors)`);

    // Pause between batches
    if (i + BATCH_SIZE < products.length) {
      await sleep(200);
    }
  }

  console.log(`\nDone! ${done} embeddings written. ${errors} failed.`);
  if (errors > 0) {
    console.log('Re-run this script to retry failed products.');
  }
}

main()
  .catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
