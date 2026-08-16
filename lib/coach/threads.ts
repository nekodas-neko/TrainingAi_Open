import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import type { getDb } from '@/lib/data/postgres/client'
import * as s from '@/lib/data/postgres/schema'

type Db = ReturnType<typeof getDb>

/** How long a conversation is kept. Applied changes (`coach_changes`) are kept indefinitely —
 *  they are a record of what happened to the program, not chat scrollback. */
export const THREAD_RETENTION_DAYS = 30

export interface StoredMessage {
  role: string
  parts: unknown[]
}

export interface ThreadSummary {
  id: string
  title: string
  updatedAt: Date
  messageCount: number
}

/**
 * Replace a thread's messages with the current client state.
 *
 * Whole-thread replace rather than append: `useChat` owns the message array, a turn can rewrite
 * earlier parts as tool results arrive, and reconciling that incrementally would be a second
 * source of truth for something the client already knows. Threads are short, so the write is small.
 */
export async function saveThread(
  db: Db,
  userId: string,
  threadId: string | null,
  messages: StoredMessage[],
): Promise<string> {
  const title = firstUserText(messages).slice(0, 120)

  let id = threadId
  if (id) {
    // Ownership check and update in one statement — a client-supplied id must not be able to
    // rewrite another user's thread.
    const updated = await db
      .update(s.coachThreads)
      .set({ updatedAt: new Date(), ...(title ? { title } : {}) })
      .where(and(eq(s.coachThreads.id, id), eq(s.coachThreads.userId, userId)))
      .returning({ id: s.coachThreads.id })
    if (updated.length === 0) id = null   // not ours (or gone) — fall through and create a new one
  }

  if (!id) {
    const [created] = await db
      .insert(s.coachThreads)
      .values({ userId, title })
      .returning({ id: s.coachThreads.id })
    id = created.id
  }

  await db.delete(s.coachMessages).where(eq(s.coachMessages.threadId, id))
  if (messages.length > 0) {
    await db.insert(s.coachMessages).values(
      messages.map((m, position) => ({
        threadId: id!,
        userId,
        role: m.role,
        parts: m.parts,
        position,
      })),
    )
  }

  await pruneOldThreads(db, userId)
  return id
}

/** Runs on every save. Without a cron layer this is the only moment retention can be enforced. */
async function pruneOldThreads(db: Db, userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - THREAD_RETENTION_DAYS * 86_400_000)
  await db.delete(s.coachThreads)
    .where(and(eq(s.coachThreads.userId, userId), lt(s.coachThreads.updatedAt, cutoff)))
}

export async function listThreads(db: Db, userId: string, limit = 20): Promise<ThreadSummary[]> {
  const rows = await db
    .select({ id: s.coachThreads.id, title: s.coachThreads.title, updatedAt: s.coachThreads.updatedAt })
    .from(s.coachThreads)
    .where(eq(s.coachThreads.userId, userId))
    .orderBy(desc(s.coachThreads.updatedAt))
    .limit(limit)
  if (rows.length === 0) return []

  // A grouped second query rather than a correlated subquery in the SELECT list. The subquery
  // version returned 0 for every thread while the same SQL by hand returned the right counts —
  // Drizzle's interpolation of the table/column references inside `sql` was not producing the
  // correlation. Two small queries are worth more than a clever one that silently reports zero.
  const counts = await db
    .select({ threadId: s.coachMessages.threadId, n: sql<number>`count(*)::int` })
    .from(s.coachMessages)
    .where(inArray(s.coachMessages.threadId, rows.map(r => r.id)))
    .groupBy(s.coachMessages.threadId)
  const byThread = new Map(counts.map(c => [c.threadId, Number(c.n)]))

  return rows.map(r => ({ ...r, messageCount: byThread.get(r.id) ?? 0 }))
}

export async function loadThread(db: Db, userId: string, threadId: string): Promise<StoredMessage[] | null> {
  const [thread] = await db
    .select({ id: s.coachThreads.id })
    .from(s.coachThreads)
    .where(and(eq(s.coachThreads.id, threadId), eq(s.coachThreads.userId, userId)))
    .limit(1)
  if (!thread) return null

  const rows = await db
    .select({ role: s.coachMessages.role, parts: s.coachMessages.parts })
    .from(s.coachMessages)
    .where(eq(s.coachMessages.threadId, threadId))
    .orderBy(asc(s.coachMessages.position))
  return rows.map(r => ({ role: r.role, parts: (r.parts as unknown[]) ?? [] }))
}

/** Applied changes, newest first. The half of history that costs nothing — the rows already exist
 *  because Apply wrote them. */
export async function listAppliedChanges(db: Db, userId: string, limit = 20) {
  return db
    .select({
      id: s.coachChanges.id,
      summary: s.coachChanges.summary,
      appliedAt: s.coachChanges.appliedAt,
      undoneAt: s.coachChanges.undoneAt,
    })
    .from(s.coachChanges)
    .where(eq(s.coachChanges.userId, userId))
    .orderBy(desc(s.coachChanges.appliedAt))
    .limit(limit)
}

function firstUserText(messages: StoredMessage[]): string {
  for (const m of messages) {
    if (m.role !== 'user') continue
    for (const part of m.parts as { type?: string; text?: string }[]) {
      if (part?.type === 'text' && part.text) return part.text
    }
  }
  return ''
}
