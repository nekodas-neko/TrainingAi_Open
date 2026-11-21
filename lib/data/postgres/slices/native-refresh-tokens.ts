// #2076 (PR a) — refresh tokens for the native app's own sign-in token (`native_refresh_tokens`,
// migration 202610071636). Native sign-in uses this ledger for revocation; refresh rotation remains separate.
//
// Server-only: the device never reads this table, so there is no local-store domain and no outbox
// (docs/rules/offline-first-and-storage.md). Not exported (credential material); claude_ro shows
// every column except `token_hash`.
//
// **No method returns `token_hash`.** Every read goes through `COLUMNS`, which leaves it out. The
// caller of `findNativeRefreshTokenByHash` already holds the hash it presented, and nothing else has
// any use for one, so a hash cannot reach a response or a log by being in a returned row.
//
// **Every method but one is scoped to the caller's user.** The exception is
// `findNativeRefreshTokenByHash`: a presented refresh token is how the server learns WHO is asking,
// so there is no user to scope by yet. The hash is the secret; the row it finds names the user,
// and every later call for that request (rotate, revoke) takes that user id.
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import type { getDb } from '../client'
import * as s from '../schema'
import type { RefreshTokenHash } from '@/lib/auth/refresh-token-hash'

type Db = ReturnType<typeof getDb>

export type NativeRefreshTokenRevokedReason =
  | 'user' | 'sign_out' | 'rotation_reuse' | 'password_change' | 'admin' | 'account_deactivated'

/** A stored refresh token, without its hash. */
export interface NativeRefreshToken {
  id: string
  userId: string
  familyId: string
  deviceLabel: string
  deviceId: string | null
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date
  rotatedAt: Date | null
  replacedBy: string | null
  revokedAt: Date | null
  revokedReason: NativeRefreshTokenRevokedReason | null
}

export interface CreateNativeRefreshTokenInput {
  userId: string
  /** From `hashRefreshToken(raw)`. The raw token is never passed to the data layer. */
  tokenHash: RefreshTokenHash
  deviceLabel: string
  deviceId?: string | null
  expiresAt: Date
}

/** Every write that adds to or revokes a family takes this lock first, so a family revocation and
 *  a rotation in the same family run one after the other. Without it, a revoke running while a
 *  rotation is uncommitted cannot see the successor that rotation inserts, and leaves it live. */
async function lockFamily(tx: Pick<Db, 'execute'>, familyId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${familyId}::text))`)
}

export interface RegrantNativeRefreshTokenInput {
  userId: string
  /** The rotated row the presented token resolved to. */
  id: string
  newTokenHash: RefreshTokenHash
  expiresAt: Date
  /** How recently the presented row must have been rotated. */
  graceSeconds: number
}

export interface RotateNativeRefreshTokenInput {
  userId: string
  /** The row the presented token resolved to. */
  id: string
  newTokenHash: RefreshTokenHash
  expiresAt: Date
}

const t = s.nativeRefreshTokens
const COLUMNS = {
  id: t.id,
  userId: t.userId,
  familyId: t.familyId,
  deviceLabel: t.deviceLabel,
  deviceId: t.deviceId,
  createdAt: t.createdAt,
  lastUsedAt: t.lastUsedAt,
  expiresAt: t.expiresAt,
  rotatedAt: t.rotatedAt,
  replacedBy: t.replacedBy,
  revokedAt: t.revokedAt,
  revokedReason: t.revokedReason,
}

const toToken = (r: Record<keyof typeof COLUMNS, unknown>): NativeRefreshToken => ({
  ...(r as Omit<NativeRefreshToken, 'revokedReason'>),
  revokedReason: (r.revokedReason as NativeRefreshTokenRevokedReason | null) ?? null,
})

/** A sign-in on a device: a new token in a new family. A family is never continued from here — only
 *  `rotateNativeRefreshToken` adds to one, so a caller cannot attach a token to someone else's.
 *
 *  #3429 item 2: an install that signs in again ends its older sign-in. When the app names its
 *  install (`deviceId`), every family this account already has for that install is revoked
 *  (`sign_out`: the old sign-in is over) in the same transaction as the insert, so a sign-in after
 *  an offline sign-out does not leave the old one valid on the server and listed twice. Scoped to
 *  the caller's user, so an install id sent from another account revokes nothing of this one's.
 *  The families are locked first (in a fixed order), so a rotation of one running at the same
 *  moment either commits before the revoke, whose UPDATE then sees its successor, or waits and finds
 *  its row revoked. No `deviceId` (an app from before #3280) revokes nothing. */
export async function createNativeRefreshToken(db: Db, input: CreateNativeRefreshTokenInput): Promise<NativeRefreshToken> {
  const deviceId = input.deviceId ?? null
  return db.transaction(async tx => {
    if (deviceId !== null) {
      const older = await tx.selectDistinct({ familyId: t.familyId }).from(t)
        .where(and(eq(t.userId, input.userId), eq(t.deviceId, deviceId), isNull(t.revokedAt)))
        .orderBy(t.familyId)
      for (const f of older) await lockFamily(tx, f.familyId)
      if (older.length) {
        await tx.update(t)
          .set({ revokedAt: sql`now()`, revokedReason: 'sign_out' })
          .where(and(
            eq(t.userId, input.userId),
            inArray(t.familyId, older.map(f => f.familyId)),
            isNull(t.revokedAt),
          ))
      }
    }
    const [row] = await tx.insert(t)
      .values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        familyId: randomUUID(),
        deviceLabel: input.deviceLabel,
        deviceId,
        expiresAt: input.expiresAt,
      })
      .returning(COLUMNS)
    return toToken(row)
  })
}

/** The row a presented token's hash names, whatever its state — rotated, revoked and expired rows
 *  included, because PR b must tell "reused after rotation" (revoke the family) from "unknown".
 *  The one unscoped read; see the header. */
export async function findNativeRefreshTokenByHash(db: Db, tokenHash: RefreshTokenHash): Promise<NativeRefreshToken | null> {
  const [row] = await db.select(COLUMNS).from(t).where(eq(t.tokenHash, tokenHash)).limit(1)
  return row ? toToken(row) : null
}

/** The caller's row by id, whatever its state. A native access token names the row it was issued
 *  with, so the bearer check can refuse it once that row's family is revoked. */
export async function findNativeRefreshTokenById(db: Db, userId: string, id: string): Promise<NativeRefreshToken | null> {
  const [row] = await db.select(COLUMNS).from(t).where(and(eq(t.id, id), eq(t.userId, userId))).limit(1)
  return row ? toToken(row) : null
}

/**
 * Exchange a live token for its successor in one transaction: mark the old row rotated (and used),
 * insert the new one in the same family and device, and link the old row to it. Returns the new row,
 * or `null` — nothing written — when the old row is not the caller's, or is already rotated, revoked
 * or expired.
 *
 * The conditional UPDATE is the race guard: two requests presenting the same token at once both
 * reach it, and only one matches `rotated_at IS NULL`. The loser gets `null`, which the refresh
 * route treats as reuse.
 */
export async function rotateNativeRefreshToken(db: Db, input: RotateNativeRefreshTokenInput): Promise<NativeRefreshToken | null> {
  const { userId } = input
  return db.transaction(async tx => {
    const [row] = await tx.select({ familyId: t.familyId }).from(t)
      .where(and(eq(t.id, input.id), eq(t.userId, userId))).limit(1)
    if (!row) return null
    await lockFamily(tx, row.familyId)
    const [old] = await tx.update(t)
      .set({ rotatedAt: sql`now()`, lastUsedAt: sql`now()` })
      .where(and(
        eq(t.id, input.id),
        eq(t.userId, userId),
        isNull(t.rotatedAt),
        isNull(t.revokedAt),
        gt(t.expiresAt, sql`now()`),
      ))
      .returning({ familyId: t.familyId, deviceLabel: t.deviceLabel, deviceId: t.deviceId })
    if (!old) return null
    const [next] = await tx.insert(t)
      .values({
        userId,
        tokenHash: input.newTokenHash,
        familyId: old.familyId,
        deviceLabel: old.deviceLabel,
        deviceId: old.deviceId,
        expiresAt: input.expiresAt,
      })
      .returning(COLUMNS)
    // By id alone: the UPDATE above, in this transaction, already proved the row is the caller's.
    // A second user predicate here could never fail on its own, so no test could hold it.
    await tx.update(t)
      .set({ replacedBy: next.id })
      .where(eq(t.id, input.id))
    return toToken(next)
  })
}

/**
 * The grace for a lost refresh response (#2076): the presented row was rotated within
 * `graceSeconds`, and the successor it was rotated to has not been used or revoked. That successor
 * is revoked — its token and the access token issued with it never reached the app — and a new one
 * takes its place in the family. Returns the new row, or `null` with nothing written when any
 * condition fails; the caller then treats the token as reused.
 */
export async function regrantNativeRefreshToken(db: Db, input: RegrantNativeRefreshTokenInput): Promise<NativeRefreshToken | null> {
  const { userId } = input
  return db.transaction(async tx => {
    const [row] = await tx.select({ familyId: t.familyId }).from(t)
      .where(and(eq(t.id, input.id), eq(t.userId, userId))).limit(1)
    if (!row) return null
    await lockFamily(tx, row.familyId)
    const [old] = await tx.select({ replacedBy: t.replacedBy, deviceLabel: t.deviceLabel, deviceId: t.deviceId })
      .from(t)
      .where(and(
        eq(t.id, input.id),
        eq(t.userId, userId),
        isNull(t.revokedAt),
        gt(t.rotatedAt, sql`now() - make_interval(secs => ${input.graceSeconds})`),
      ))
    if (!old?.replacedBy) return null
    const [superseded] = await tx.update(t)
      .set({ revokedAt: sql`now()`, revokedReason: 'rotation_reuse' })
      .where(and(
        eq(t.id, old.replacedBy),
        eq(t.userId, userId),
        isNull(t.rotatedAt),
        isNull(t.lastUsedAt),
        isNull(t.revokedAt),
      ))
      .returning({ id: t.id })
    if (!superseded) return null
    const [next] = await tx.insert(t)
      .values({
        userId,
        tokenHash: input.newTokenHash,
        familyId: row.familyId,
        deviceLabel: old.deviceLabel,
        deviceId: old.deviceId,
        expiresAt: input.expiresAt,
      })
      .returning(COLUMNS)
    await tx.update(t)
      .set({ replacedBy: next.id })
      .where(eq(t.id, input.id))
    return toToken(next)
  })
}

/** Revoke one token. True when it was the caller's and not already revoked; the first reason given
 *  is kept. */
export async function revokeNativeRefreshToken(
  db: Db, userId: string, id: string, reason: NativeRefreshTokenRevokedReason,
): Promise<boolean> {
  const rows = await db.update(t)
    .set({ revokedAt: sql`now()`, revokedReason: reason })
    .where(and(eq(t.id, id), eq(t.userId, userId), isNull(t.revokedAt)))
    .returning({ id: t.id })
  return rows.length > 0
}

/** Revoke every not-yet-revoked token in a family (one device's sign-in): reuse detection, or
 *  revoking a device from a list. Returns how many rows changed. Scoped to the caller's user as
 *  well as the family, so a family id from anywhere else cannot revoke another account's device. */
export async function revokeNativeRefreshTokenFamily(
  db: Db, userId: string, familyId: string, reason: NativeRefreshTokenRevokedReason,
): Promise<number> {
  return db.transaction(async tx => {
    await lockFamily(tx, familyId)
    const rows = await tx.update(t)
      .set({ revokedAt: sql`now()`, revokedReason: reason })
      .where(and(eq(t.familyId, familyId), eq(t.userId, userId), isNull(t.revokedAt)))
      .returning({ id: t.id })
    return rows.length
  })
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** #3797: take the family lock of every family the account has, in a fixed order. A caller that
 *  will also lock the `users` row (linking an identity) takes these FIRST: a rotation holds its
 *  family lock while its insert waits on the `users` row (the foreign-key check), so locking the
 *  user first and a family second can deadlock with it. Advisory locks are re-entrant, so the
 *  revocation below taking them again is free. */
export async function lockEveryNativeFamily(tx: Tx, userId: string): Promise<void> {
  const rows = await tx.selectDistinct({ familyId: t.familyId }).from(t)
    .where(eq(t.userId, userId))
    .orderBy(t.familyId)
  for (const r of rows) await lockFamily(tx, r.familyId)
}

/**
 * #3797: end every native sign-in the account has, inside the caller's transaction. Used when a
 * password is cleared by linking a sign-in method onto the account: whoever signed in with that
 * password, on any device, is signed out. Every row not yet revoked is revoked (rotated and expired
 * ones too, so presenting one later reads as revoked rather than as reuse). The reason is
 * `password_change`, the CHECK's value for exactly this; a new value would need a migration.
 *
 * Fails closed: after the UPDATE, a row still unrevoked (one a concurrent sign-in inserted that this
 * statement could not see) throws, and the caller's transaction, the link included, rolls back.
 * Returns how many rows it revoked.
 */
export async function revokeEveryNativeSignIn(tx: Tx, userId: string): Promise<number> {
  await lockEveryNativeFamily(tx, userId)
  const revoked = await tx.update(t)
    .set({ revokedAt: sql`now()`, revokedReason: 'password_change' })
    .where(and(eq(t.userId, userId), isNull(t.revokedAt)))
    .returning({ id: t.id })
  const [left] = await tx.select({ n: sql<number>`count(*)::int` }).from(t)
    .where(and(eq(t.userId, userId), isNull(t.revokedAt)))
  if ((left?.n ?? 0) !== 0) throw new Error('native sign-ins changed while they were being ended')
  return revoked.length
}

/** The caller's live tokens — one per signed-in device: not rotated, not revoked, not expired.
 *  Newest first. Never carries a hash. */
export async function listActiveNativeRefreshTokens(db: Db, userId: string): Promise<NativeRefreshToken[]> {
  const rows = await db.select(COLUMNS).from(t)
    .where(and(
      eq(t.userId, userId),
      isNull(t.revokedAt),
      isNull(t.rotatedAt),
      gt(t.expiresAt, sql`now()`),
    ))
    .orderBy(desc(t.createdAt), desc(t.id))
  return rows.map(toToken)
}

/** A signed-in device, for the Signed-in devices screen (#3280). One per live family. */
export interface NativeDevice {
  familyId: string
  deviceLabel: string
  /** When the family's first token was issued: the sign-in, not the latest rotation. */
  signedInAt: Date
  /** The live token's last use, else when it was issued, which is the last refresh. */
  lastUsedAt: Date
}

/** The caller's signed-in devices, newest sign-in first: one per family that still has a live token.
 *  Carries no token id and no hash. */
export async function listNativeDevices(db: Db, userId: string): Promise<NativeDevice[]> {
  const live = await listActiveNativeRefreshTokens(db, userId)
  if (live.length === 0) return []
  const rows = await db.select({ familyId: t.familyId, signedInAt: sql<Date>`min(${t.createdAt})` })
    .from(t)
    .where(and(eq(t.userId, userId), inArray(t.familyId, live.map(r => r.familyId))))
    .groupBy(t.familyId)
  const first = new Map(rows.map(r => [r.familyId, new Date(r.signedInAt)]))
  return live
    .map(r => ({
      familyId: r.familyId,
      deviceLabel: r.deviceLabel,
      signedInAt: first.get(r.familyId) ?? r.createdAt,
      lastUsedAt: r.lastUsedAt ?? r.createdAt,
    }))
    .sort((a, b) => b.signedInAt.getTime() - a.signedInAt.getTime())
}
