/**
 * embed-policy.ts
 * Reads prisma/policy.txt, chunks it by paragraph, generates Gemini embeddings
 * for each chunk, and inserts them into the PolicyChunk table.
 *
 * Run once (safe to re-run — clears old chunks first):
 *   npx tsx prisma/embed-policy.ts
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../app/generated/prisma/client';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

// ── Clients ───────────────────────────────────────────────────────────────────

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL!,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  connectionTimeoutMillis: 30000,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

// ── Chunking ──────────────────────────────────────────────────────────────────

/**
 * Splits the policy text into chunks by paragraph (double newline).
 * Merges very short paragraphs (< 80 chars) with the next one
 * to avoid embedding near-empty chunks.
 * Returns array of { heading, content } objects.
 */
function chunkPolicy(text: string): { heading: string | null; content: string }[] {
  // Normalize line endings
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split on blank lines (paragraph breaks)
  const rawChunks = normalized.split(/\n{2,}/).map((c) => c.trim()).filter(Boolean);

  const chunks: { heading: string | null; content: string }[] = [];
  let currentHeading: string | null = null;
  let buffer = '';

  for (const chunk of rawChunks) {
    // Detect headings: ALL CAPS line, or line ending with ':', or short bold-like line < 60 chars
    const isHeading =
      chunk === chunk.toUpperCase() ||
      (chunk.endsWith(':') && chunk.length < 80) ||
      (chunk.length < 60 && !chunk.includes('.'));

    if (isHeading) {
      // Save buffered content before starting new section
      if (buffer.trim()) {
        chunks.push({ heading: currentHeading, content: buffer.trim() });
        buffer = '';
      }
      currentHeading = chunk.replace(/:$/, '').trim();
      continue;
    }

    // Merge short paragraphs into buffer
    if (buffer && buffer.length < 120) {
      buffer += ' ' + chunk;
    } else {
      if (buffer.trim()) {
        chunks.push({ heading: currentHeading, content: buffer.trim() });
      }
      buffer = chunk;
    }
  }

  // Flush remaining buffer
  if (buffer.trim()) {
    chunks.push({ heading: currentHeading, content: buffer.trim() });
  }

  return chunks;
}

// ── Embedding ─────────────────────────────────────────────────────────────────

async function embedText(text: string): Promise<number[]> {
  const result = await embeddingModel.embedContent({
    content: { parts: [{ text }], role: 'user' },
    outputDimensionality: 768,
  } as any);
  return result.embedding.values;
}

async function saveChunkEmbedding(id: number, vector: number[]): Promise<void> {
  const vectorStr = `[${vector.join(',')}]`;
  await pool.query(
    `UPDATE "PolicyChunk" SET embedding = $1::vector WHERE id = $2`,
    [vectorStr, id]
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const policyPath = path.join(__dirname, 'policy.txt');

  if (!fs.existsSync(policyPath)) {
    console.error('❌ policy.txt not found at prisma/policy.txt');
    console.error('   Create the file and paste your policy text into it, then re-run.');
    process.exit(1);
  }

  const text = fs.readFileSync(policyPath, 'utf-8');
  const chunks = chunkPolicy(text);

  console.log(`Found ${chunks.length} chunks from policy.txt`);
  if (chunks.length === 0) {
    console.error('No chunks extracted — check your policy.txt formatting.');
    process.exit(1);
  }

  // Preview first 3 chunks
  chunks.slice(0, 3).forEach((c, i) => {
    console.log(`  [${i}] heading="${c.heading}" content="${c.content.slice(0, 80)}..."`);
  });

  // Clear existing policy chunks (safe re-run)
  await prisma.policyChunk.deleteMany({});
  console.log('Cleared existing PolicyChunk rows.');

  // Insert all chunks (without embeddings first)
  const created = await prisma.policyChunk.createMany({
    data: chunks.map((c, i) => ({
      heading: c.heading,
      content: c.content,
      chunkIndex: i,
    })),
  });
  console.log(`Inserted ${created.count} PolicyChunk rows. Now embedding...`);

  // Fetch inserted rows to get their IDs
  const rows = await prisma.policyChunk.findMany({ orderBy: { chunkIndex: 'asc' } });

  let done = 0;
  let errors = 0;

  for (const row of rows) {
    // Embed heading + content together for richer retrieval
    const textToEmbed = row.heading
      ? `${row.heading}\n${row.content}`
      : row.content;

    try {
      const vector = await embedText(textToEmbed);
      await saveChunkEmbedding(row.id, vector);
      done++;
      if (done % 5 === 0 || done === rows.length) {
        console.log(`✔ ${done}/${rows.length} chunks embedded (${errors} errors)`);
      }
      await sleep(150); // gentle rate-limit pause
    } catch (err: any) {
      errors++;
      console.error(`✗ Chunk id=${row.id} failed:`, err?.message ?? err);
      await sleep(500);
    }
  }

  // Create cosine similarity index on PolicyChunk embeddings
  await pool.query(`
    CREATE INDEX IF NOT EXISTS policy_embedding_idx
    ON "PolicyChunk" USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 10)
  `);
  console.log('✔ ivfflat index created on PolicyChunk.embedding');

  console.log(`\nDone! ${done} policy chunks embedded. ${errors} failed.`);
  if (errors > 0) console.log('Re-run to retry failed chunks.');
}

main()
  .catch((e) => { console.error('Fatal error:', e); process.exit(1); })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
