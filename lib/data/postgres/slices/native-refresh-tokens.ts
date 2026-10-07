// #2076 (PR a) — refresh tokens for the native app's own sign-in token (`native_refresh_tokens`,
// migration 202610071636). Nothing calls these yet: issuing, rotating and revoking tokens is PR b.
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
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
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
 *  `rotateNativeRefreshToken` adds to one, so a caller cannot attach a token to someone else's. */
export async function createNativeRefreshToken(db: Db, input: CreateNativeRefreshTokenInput): Promise<NativeRefreshToken> {
  const [row] = await db.insert(t)
    .values({
      userId: input.userId,
      tokenHash: input.tokenHash,
      familyId: randomUUID(),
      deviceLabel: input.deviceLabel,
      deviceId: input.deviceId ?? null,
      expiresAt: input.expiresAt,
    })
    .returning(COLUMNS)
  return toToken(row)
}

/** The row a presented token's hash names, whatever its state — rotated, revoked and expired rows
 *  included, because PR b must tell "reused after rotation" (revoke the family) from "unknown".
 *  The one unscoped read; see the header. */
export async function findNativeRefreshTokenByHash(db: Db, tokenHash: RefreshTokenHash): Promise<NativeRefreshToken | null> {
  const [row] = await db.select(COLUMNS).from(t).where(eq(t.tokenHash, tokenHash)).limit(1)
  return row ? toToken(row) : null
}

/**
 * Exchange a live token for its successor in one transaction: mark the old row rotated (and used),
 * insert the new one in the same family and device, and link the old row to it. Returns the new row,
 * or `null` — nothing written — when the old row is not the caller's, or is already rotated, revoked
 * or expired.
 *
 * The conditional UPDATE is the race guard: two requests presenting the same token at once both
 * reach it, and only one matches `rotated_at IS NULL`. The loser gets `null`; PR b decides whether
 * that is reuse (revoke the family) or a retry inside a grace window.
 */
export async function rotateNativeRefreshToken(db: Db, input: RotateNativeRefreshTokenInput): Promise<NativeRefreshToken | null> {
  const { userId } = input
  return db.transaction(async tx => {
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
  const rows = await db.update(t)
    .set({ revokedAt: sql`now()`, revokedReason: reason })
    .where(and(eq(t.familyId, familyId), eq(t.userId, userId), isNull(t.revokedAt)))
    .returning({ id: t.id })
  return rows.length
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
