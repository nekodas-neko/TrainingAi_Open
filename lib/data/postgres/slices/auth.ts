import { and, eq, gt, lt, sql } from 'drizzle-orm'
import { normalizeEmail } from '@trainingai/shared/validation/email'
import type { getDb } from '../client'
import { authIdentities, appleAuthAttempts, users } from '../schema'
import { IdentityConflict } from '@/lib/auth/identity'
import { revokeEveryNativeSignIn } from './native-refresh-tokens'
import type { AuthProvider } from '@/lib/auth/identity'

type Db = ReturnType<typeof getDb>

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * #3829: end every sign-in of the account made before `at`, web cookies included, without touching
 * the data epoch (`sessions_valid_from`), so no device wipes its store. Compared with each token's
 * `signedInAt` in `refreshIsActiveClaim`. `at` is the app server's clock, not the database's: the
 * sign-in making the link is stamped by this server right after, and must land at or after it.
 * The cut-off only moves forward (GREATEST ignores the NULL of an account that has none), so a later
 * caller (a "sign out everywhere") can share the column. Throws unless exactly one row was set, so
 * the caller's transaction rolls back rather than link with the old sign-ins still valid.
 */
export async function endSignInsBefore(tx: Tx | Db, userId: string, at: Date = new Date()): Promise<void> {
  const rows = await tx.update(users)
    .set({ signInsValidFrom: sql`GREATEST(${users.signInsValidFrom}, ${at.toISOString()}::timestamptz)` })
    .where(eq(users.id, userId))
    .returning({ id: users.id })
  if (rows.length !== 1) throw new Error('sign-in cut-off was not recorded')
}

export async function getUserByProvider(db: Db, provider: AuthProvider, subject: string) {
  const [row] = await db.select({ user: users }).from(authIdentities)
    .innerJoin(users, eq(authIdentities.userId, users.id))
    .where(and(eq(authIdentities.provider, provider), eq(authIdentities.subject, subject))).limit(1)
  return row?.user ?? null
}

export async function getUserProviders(db: Db, userId: string): Promise<AuthProvider[]> {
  const rows = await db.select({ provider: authIdentities.provider }).from(authIdentities)
    .where(eq(authIdentities.userId, userId))
  return rows.map(x => x.provider)
}

/** #3797: when the newest sign-in method (Google, Apple) was linked onto the account; null when none. */
export async function getLatestIdentityLinkedAt(db: Db, userId: string): Promise<Date | null> {
  const [row] = await db.select({ at: sql<Date | null>`max(${authIdentities.createdAt})` }).from(authIdentities)
    .where(eq(authIdentities.userId, userId))
  return row?.at ? new Date(row.at) : null
}

export async function linkIdentity(db: Db, userId: string, provider: AuthProvider, subject: string, email?: string) {
  return db.transaction(async x => {
    const [user] = await x.select({ isActive: users.isActive }).from(users).where(eq(users.id, userId)).for('update')
    if (!user?.isActive) {
      return false
    }
    await x.insert(authIdentities).values({ userId, provider, subject, email: email ? normalizeEmail(email) : null }).onConflictDoNothing()
    const [identity] = await x.select({ userId: authIdentities.userId }).from(authIdentities)
      .where(and(eq(authIdentities.provider, provider), eq(authIdentities.subject, subject)))
    return identity?.userId === userId
  })
}

export async function createProviderUser(db: Db, provider: AuthProvider, subject: string, email: string, name: string | undefined, isActive: boolean) {
  const normalized = normalizeEmail(email)
  return db.transaction(async x => {
    const [linked] = await x.select({ user: users }).from(authIdentities)
      .innerJoin(users, eq(authIdentities.userId, users.id))
      .where(and(eq(authIdentities.provider, provider), eq(authIdentities.subject, subject)))
    if (linked) {
      return linked.user
    }
    let [user] = await x.select().from(users).where(eq(sql`lower(${users.email})`, normalized)).for('update')
    const [inserted] = user ? [] : await x.insert(users).values({ email: normalized, name: name ?? null, isActive }).onConflictDoNothing().returning()
    if (inserted) {
      user = inserted
    } else {
      if (!user) {
        ;[user] = await x.select().from(users).where(eq(sql`lower(${users.email})`, normalized)).for('update')
      }
      if (!user) {
        throw new IdentityConflict()
      }
      const identities = await x.select().from(authIdentities).where(eq(authIdentities.userId, user.id))
      if (identities.some(y => y.provider === provider && y.subject === subject)) {
        return user
      }
      if (user.isActive || user.oauthSub || identities.length) {
        throw new IdentityConflict()
      }
      const hadPassword = user.passwordHash !== null
      // #3830: the link applies the invite as Google's does (`linkOAuthAccount`): `isActive` is the
      // caller's verdict (an authoritative, invited address), and it only ever activates.
      const updated = await x.update(users).set({ passwordHash: null, ...(isActive ? { isActive: true } : {}) })
        .where(eq(users.id, user.id)).returning()
      if (updated.length !== 1) {
        throw new IdentityConflict()
      }
      ;[user] = updated
      // #3797: a cleared password ends that password's native sign-ins, as a Google link does
      // (`linkOAuthAccount`). Only an inactive account reaches here, and an inactive account is not
      // issued or rotated native sign-ins, so the user row is locked before the families without
      // the deadlock the Google link orders against.
      if (hadPassword) {
        await revokeEveryNativeSignIn(x, user.id)
        await endSignInsBefore(x, user.id) // #3829: and its web sessions
      }
    }
    await x.insert(authIdentities).values({ userId: user.id, provider, subject, email: normalized })
    return user
  })
}

export async function createAppleAuthAttempt(db: Db, nonceHash: string, userId: string | null) {
  await db.delete(appleAuthAttempts).where(lt(appleAuthAttempts.expiresAt, new Date()))
  const [attempt] = await db.insert(appleAuthAttempts).values({ nonceHash, userId, expiresAt: new Date(Date.now() + 10 * 60 * 1000) }).returning()
  return attempt
}

export async function getAppleAuthAttempt(db: Db, id: string) {
  const [attempt] = await db.select().from(appleAuthAttempts)
    .where(and(eq(appleAuthAttempts.id, id), gt(appleAuthAttempts.expiresAt, new Date())))
  return attempt ?? null
}

export async function consumeAppleAuthAttempt(db: Db, id: string) {
  const [attempt] = await db.delete(appleAuthAttempts)
    .where(and(eq(appleAuthAttempts.id, id), gt(appleAuthAttempts.expiresAt, new Date()))).returning()
  return attempt ?? null
}
