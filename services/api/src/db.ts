import { Prisma, PrismaClient } from '@prisma/client';

/** PRISMA_QUERY_EVENTS=1 emits `query` events (SQL + params + duration); used by the load-test benchmark for EXPLAIN plans. */
export const prisma = new PrismaClient(process.env.PRISMA_QUERY_EVENTS === '1' ? { log: [{ emit: 'event', level: 'query' }] } : undefined);
export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

/** Serializable-ish retries for transactions that hit write conflicts or deadlocks. */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await prisma.$transaction(fn, { timeout: 15_000, maxWait: 5_000 });
    } catch (e) {
      const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined;
      const retryable = code === 'P2034' || (e instanceof Error && /deadlock|could not serialize/i.test(e.message));
      if (!retryable || i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 20 * i));
    }
  }
}
