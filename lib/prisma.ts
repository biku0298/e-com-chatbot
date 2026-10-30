import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';
import { PrismaClient } from '@/app/generated/prisma/client';

let client: PrismaClient | undefined;

/** One Prisma client per process (server only). */
export function getPrisma(): PrismaClient {
  return client ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
}
