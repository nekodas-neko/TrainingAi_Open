// Oura Cloud OAuth tokens (#2858), one row per user in `oura_tokens` (migrations 083 and 087).
//
// Server-only: the device never reads this table, so there is no local-store domain and no outbox
// (docs/rules/offline-first-and-storage.md). Not exported (credential material); claude_ro withholds
// both token columns and the webhook signing key.
//
// **This slice never sees a plaintext token.** `access_token` and `refresh_token` go in and come out
// as `EncryptedOuraToken`, which only `lib/oura/cloud/token-cipher.ts` can make or open. Every method
// is scoped to the caller's user.
import { and, desc, eq, sql } from 'drizzle-orm'
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
  /** #3204: when Oura refused the grant; null while none is known. New tokens clear it. */
  reauthRequiredAt: Date | null
  /** #2861: the last verified webhook event for this user; null until one arrives. */
  lastWebhookAt: Date | null
  /** #2861: the last time Oura data was written for this user; null until some is. */
  lastDataAt: Date | null
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
      reauthRequiredAt: t.reauthRequiredAt, lastWebhookAt: t.lastWebhookAt, lastDataAt: t.lastDataAt,
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

/**
 * Inserts or replaces the caller's tokens. A unique violation on `oura_user_id` propagates (23505).
 * Clears `reauth_required_at` (#3204): Oura has just issued these tokens, on a connect or a refresh,
 * so the grant is alive again.
 */
export async function saveOuraCloudTokens(db: Db, userId: string, input: SaveOuraCloudTokensInput): Promise<void> {
  const values = {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresAt: input.expiresAt,
    scope: input.scope,
    reauthRequiredAt: null,
    updatedAt: sql`now()`,
    ...(input.ouraUserId !== undefined ? { ouraUserId: input.ouraUserId } : {}),
  }
  await db.insert(t).values({ userId, ...values }).onConflictDoUpdate({ target: t.userId, set: values })
}

/**
 * #3204: records that Oura refused the caller's grant, unless the row has been saved since
 * `unchangedSince` (the `updatedAt` the caller read before asking Oura). A connect or refresh landing
 * in between holds newer tokens, and marking them would report a working connection as dead. An
 * earlier mark is kept, so the time says when the feed stopped. `updated_at` is left alone: it is
 * when tokens were last saved, and the guard above reads it.
 *
 * True when the row was marked (or already was); false when there is no row, or it moved on.
 * Postgres keeps microseconds and a JS `Date` milliseconds, so "not saved since" is "before the next
 * millisecond".
 */
export async function markOuraCloudReauthRequired(db: Db, userId: string, unchangedSince: Date): Promise<boolean> {
  const marked = await db.update(t)
    .set({ reauthRequiredAt: sql`COALESCE(${t.reauthRequiredAt}, now())` })
    .where(and(eq(t.userId, userId), sql`${t.updatedAt} < ${unchangedSince.toISOString()}::timestamptz + interval '1 millisecond'`))
    .returning({ userId: t.userId })
  return marked.length > 0
}

/**
 * #2861: stamps the user's last verified webhook event. `updated_at` is left alone: it is when tokens
 * were last saved, and the reauth guard above reads it. A user with no row is a no-op.
 */
export async function touchOuraCloudWebhook(db: Db, userId: string): Promise<void> {
  await db.update(t).set({ lastWebhookAt: sql`now()` }).where(eq(t.userId, userId))
}

/** #2861: stamps the last time Oura data was written for the user. As above, `updated_at` is left alone. */
export async function touchOuraCloudData(db: Db, userId: string): Promise<void> {
  await db.update(t).set({ lastDataAt: sql`now()` }).where(eq(t.userId, userId))
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
 * #3079: every user with a live OAuth connection (an access token, no personal access token), for
 * the daily reconciliation read. App-level like the webhook subscriptions: one pass covers everyone.
 */
export async function listOuraCloudConnectedUserIds(db: Db): Promise<string[]> {
  // A connection marked as needing reauth (#3204) stays listed: its read ends in `reauth`, which the
  // reconcile reports, and that report is how a dead grant is seen.
  const rows = await db.select({ userId: t.userId }).from(t)
    .where(sql`${t.accessToken} IS NOT NULL AND ${t.personalAccessToken} IS NULL`)
  return rows.map(r => r.userId)
}

/**
 * #2985: the local day the user switched to the Oura API, or null when they never did.
 *
 * It has to survive a disconnect and reconnect (the Oura screen offers only "Disconnect", so
 * re-running the import means connecting again, which recreates the `oura_tokens` row), so it is
 * not the connection's creation:
 *   - with an Oura Cloud connection, it is the day of the user's newest raw Bluetooth frame (by
 *     ring time; `recorded_at`, when the server received it). The raw archive is never pruned or
 *     mutated, and packing keeps the newest frames unpacked, so this is the day the ring stopped
 *     sending. If the ring goes back on Bluetooth, the day moves forward with it;
 *   - with no Bluetooth history at all, it is the day the connection was created;
 *   - without a connection, there is no switch.
 * Days are in the user's timezone.
 *
 * A row still holding a personal access token predates the OAuth connector (#2858), so it reads as
 * no connection.
 */
export async function getOuraCloudSwitchDay(db: Db, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ createdAt: t.createdAt, pat: t.personalAccessToken, access: t.accessToken, timezone: s.users.timezone })
    .from(t)
    .innerJoin(s.users, eq(s.users.id, t.userId))
    .where(eq(t.userId, userId))
    .limit(1)
  if (!row || row.pat != null || row.access == null) return null
  // The newest frame by ring time: a backward scan of the (user_id, ring_timestamp_ds, …) unique index.
  const [lastFrame] = await db
    .select({ recordedAt: s.ouraRawSamples.recordedAt })
    .from(s.ouraRawSamples)
    .where(eq(s.ouraRawSamples.userId, userId))
    .orderBy(desc(s.ouraRawSamples.ringTimestampDs))
    .limit(1)
  return toAestDay(lastFrame?.recordedAt ?? row.createdAt, row.timezone)
}
