// Oura Cloud OAuth tokens (#2858), one row per user in `oura_tokens` (migrations 083 and 087).
//
// Server-only: the device never reads this table, so there is no local-store domain and no outbox
// (docs/rules/offline-first-and-storage.md). Not exported (credential material); claude_ro withholds
// both token columns and the webhook signing key.
//
// **This slice never sees a plaintext token.** `access_token` and `refresh_token` go in and come out
// as `EncryptedOuraToken`, which only `lib/oura/cloud/token-cipher.ts` can make or open. Every method
// is scoped to the caller's user.
import { eq, sql } from 'drizzle-orm'
import { toAestDay } from '@trainingai/shared/date-utils'
import type { getDb } from '../client'
import * as s from '../schema'
import type { EncryptedOuraToken } from '@/lib/oura/cloud/token-cipher'

type Db = ReturnType<typeof getDb>

export interface OuraCloudTokenRow {
  userId: string
  accessToken: EncryptedOuraToken | null
  refreshToken: EncryptedOuraToken | null
  expiresAt: Date | null
  scope: string | null
  ouraUserId: string | null
  updatedAt: Date
}

export interface SaveOuraCloudTokensInput {
  accessToken: EncryptedOuraToken
  refreshToken: EncryptedOuraToken
  expiresAt: Date
  scope: string | null
  /** Set on connect; left as stored on a refresh. */
  ouraUserId?: string
}

const t = s.ouraTokens

export async function getOuraCloudTokens(db: Db, userId: string): Promise<OuraCloudTokenRow | null> {
  const [row] = await db
    .select({
      userId: t.userId, accessToken: t.accessToken, refreshToken: t.refreshToken,
      expiresAt: t.expiresAt, scope: t.scope, ouraUserId: t.ouraUserId, updatedAt: t.updatedAt,
    })
    .from(t)
    .where(eq(t.userId, userId))
    .limit(1)
  if (!row) return null
  return {
    ...row,
    accessToken: row.accessToken as EncryptedOuraToken | null,
    refreshToken: row.refreshToken as EncryptedOuraToken | null,
  }
}

/** Inserts or replaces the caller's tokens. A unique violation on `oura_user_id` propagates (23505). */
export async function saveOuraCloudTokens(db: Db, userId: string, input: SaveOuraCloudTokensInput): Promise<void> {
  const values = {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresAt: input.expiresAt,
    scope: input.scope,
    updatedAt: sql`now()`,
    ...(input.ouraUserId !== undefined ? { ouraUserId: input.ouraUserId } : {}),
  }
  await db.insert(t).values({ userId, ...values }).onConflictDoUpdate({ target: t.userId, set: values })
}

/** True when the caller had a row and it is gone now. */
export async function deleteOuraCloudTokens(db: Db, userId: string): Promise<boolean> {
  const deleted = await db.delete(t).where(eq(t.userId, userId)).returning({ userId: t.userId })
  return deleted.length > 0
}

/**
 * The TrainingAI user an Oura account is connected to (#2859), for routing a webhook event by its
 * `user_id`. `oura_user_id` is unique, so there is at most one. Null when nobody here holds it, e.g.
 * after a disconnect.
 */
export async function getUserIdByOuraUserId(db: Db, ouraUserId: string): Promise<string | null> {
  const [row] = await db.select({ userId: t.userId }).from(t).where(eq(t.ouraUserId, ouraUserId)).limit(1)
  return row?.userId ?? null
}

/**
 * #2985: the local day the user switched to the Oura API, or null when they never did. It is the
 * day the connection row was created (`oura_tokens.created_at`) in the user's timezone; a refresh
 * leaves `created_at` alone, and a disconnect deletes the row, so a reconnect moves it later.
 *
 * A row still holding a personal access token predates the OAuth connector (#2858), so its
 * `created_at` is not a switch moment and it reads as no switch.
 */
export async function getOuraCloudSwitchDay(db: Db, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ createdAt: t.createdAt, pat: t.personalAccessToken, access: t.accessToken, timezone: s.users.timezone })
    .from(t)
    .innerJoin(s.users, eq(s.users.id, t.userId))
    .where(eq(t.userId, userId))
    .limit(1)
  if (!row || row.pat != null || row.access == null) return null
  return toAestDay(row.createdAt, row.timezone)
}
