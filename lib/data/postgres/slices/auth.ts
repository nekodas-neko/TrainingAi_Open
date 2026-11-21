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
 * #3829 / #3854: end every sign-in of the account made up to now, web cookies included, without
 * touching the data epoch (`sessions_valid_from`), so no device wipes its store. Compared with each
 * token's `signedInAt` by `signedInBeforeSignInCutoff`, and with a native refresh row's `created_at`.
 *
 * **One clock, the database's (#3949 review N1).** The cut-off is the next whole second after the
 * database's `clock_timestamp()` at this write, and after any earlier cut-off: strictly later than
 * every stamp taken before it (`signInStampFor`, and the `created_at` a native row is given), and a
 * whole second, so the comparison has no rounding. It always moves forward, by at least a second
 * past an earlier one, so a sign-in stamped at an earlier cut-off (the one a link just made) is
 * ended by the next. `clock_timestamp()`, not `now()`: `now()` is when the transaction began, which
 * is before any lock it waited for (`endSignInsOnSignOut` waits for a rotation in flight).
 *
 * Returns the new cut-off. Throws unless exactly one row was set, so the caller's transaction rolls
 * back rather than leave the old sign-ins valid.
 */
export async function endSignInsBefore(tx: Tx | Db, userId: string): Promise<Date> {
  const rows = await tx.update(users)
    .set({
      signInsValidFrom: sql`GREATEST(
        to_timestamp(floor(extract(epoch FROM clock_timestamp())) + 1),
        to_timestamp(ceil(extract(epoch FROM ${users.signInsValidFrom})) + 1)
      )`,
    })
    .where(eq(users.id, userId))
    .returning({ at: users.signInsValidFrom })
  if (rows.length !== 1 || !rows[0].at) throw new Error('sign-in cut-off was not recorded')
  return new Date(rows[0].at)
}

/**
 * The `signedInAt` a new web sign-in (or a re-issued cookie) is stamped with: the database clock in
 * whole seconds, raised to the account's sign-in cut-off when that is later. Read after any link or
 * password change this sign-in made has committed, so it is at or after the cut-off they set and the
 * sign-in keeps its session; a sign-in that read the row before a sign-out committed is below the
 * cut-off that sign-out writes (`endSignInsBefore`), and is ended by it. Throws when the account has
 * no row: the caller's sign-in then fails, rather than be stamped from another clock.
 */
export async function signInStampFor(db: Tx | Db, userId: string): Promise<number> {
  const rows = await db.select({
    stamp: sql<string>`GREATEST(
      floor(extract(epoch FROM clock_timestamp())),
      ceil(extract(epoch FROM ${users.signInsValidFrom}))
    )::bigint`,
  }).from(users).where(eq(users.id, userId)).limit(1)
  const stamp = Number(rows[0]?.stamp)
  if (!rows.length || !Number.isSafeInteger(stamp)) throw new Error('sign-in stamp could not be read')
  return stamp
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
