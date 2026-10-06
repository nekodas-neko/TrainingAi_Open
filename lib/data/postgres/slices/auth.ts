import { and, eq, gt, lt, sql } from 'drizzle-orm'
import { normalizeEmail } from '@trainingai/shared/validation/email'
import type { getDb } from '../client'
import { authIdentities, appleAuthAttempts, users } from '../schema'
import { IdentityConflict } from '@/lib/auth/identity'
import type { AuthProvider } from '@/lib/auth/identity'

type Db = ReturnType<typeof getDb>

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
      ;[user] = await x.update(users).set({ passwordHash: null }).where(eq(users.id, user.id)).returning()
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
