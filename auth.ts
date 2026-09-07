import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { getRepositoryAsync } from "@/lib/data"
import { authConfig } from "./auth.config"
import { rateLimit } from "@/lib/rate-limit"
import { clientIp } from "@trainingai/shared/http/client-ip"
import type { JWT } from "next-auth/jwt"
import type { Session } from "next-auth"
import { refreshIsActiveClaim } from "@/lib/auth/is-active-refresh"

const nextAuth = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const submitted = credentials?.email as string | undefined
        const password = credentials?.password as string | undefined
        if (!submitted || !password) return null

        // PS-25 — ONE normalisation, feeding both the rate-limit key and the lookup.
        //
        // They were written separately and drifted: the key folded case, the lookup folded case
        // *and trimmed*, so ` user@x` and `user@x ` were fresh 20-attempt buckets against the same
        // account. Verified live before the fix — after 20 misses, attempt 21 (plain, correct
        // password) was refused and attempt 22 (one leading space, correct password) signed in.
        // Padded attempts per account were therefore unbounded.
        //
        // Two derivations of "the same email" are what made that possible, so there is one now and
        // the key is built from it. Do not reintroduce a second `.toLowerCase()` here.
        const email = submitted.toLowerCase().trim()

        // Per-IP before per-email, so a spray across many accounts is stopped without first
        // spending a victim's bucket. `clientIp` counts in from the right (Q-493) — the leftmost
        // X-Forwarded-For entry is caller-supplied, and keying on it lets the caller choose its own
        // bucket.
        //
        // 50 per 15 minutes is deliberately loose. The per-email limit already bounds a brute force
        // against one account; this bounds *spraying across accounts* from one source, which a
        // per-email limit cannot see at all. A household or CGNAT egress shares this key, so a
        // tighter number would lock out real users to slow an attacker who can simply use more
        // addresses.
        if (!rateLimit(`login-ip:${clientIp(request)}`, 50, 15 * 60 * 1000)) return null

        // 20 attempts per email per 15 minutes — prevents account-specific brute force
        if (!rateLimit(`login:${email}`, 20, 15 * 60 * 1000)) return null

        const repo = await getRepositoryAsync()
        const user = await repo.getUserByEmail(email)
        if (!user?.passwordHash) return null

        const valid = await bcrypt.compare(password, user.passwordHash)
        if (!valid) return null

        // Return the user regardless of isActive — signIn callback handles the redirect
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? null,
          isActive: user.isActive,
          isAdmin: user.isAdmin,
          timezone: user.timezone,
          sex: (user as any).sex ?? null,
          heightCm: user.heightCm ?? null,
          dateOfBirth: user.dateOfBirth ?? null,
          activityLevel: user.activityLevel ?? null,
          friendCode: user.friendCode ?? null,
          equippedTitle: user.equippedTitle ?? null,
        }
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,

    // Keep the isActive claim from going stale — see lib/auth/is-active-refresh.ts for
    // why this lives here (Node) rather than in the Edge-runtime middleware that enforces it.
    async jwt(params) {
      const token = await authConfig.callbacks!.jwt!(params) as JWT
      if (params.user) return token // just signed in — isActive is already fresh
      return refreshIsActiveClaim(token, async (userId) => {
        const repo = await getRepositoryAsync()
        return repo.getUserById(userId)
      })
    },

    async signIn({ user, account }) {
      const repo = await getRepositoryAsync()

      if (account?.provider === "google") {
        const oauthSub = account.providerAccountId

        // If an email/password account already exists for this email, link the
        // Google OAuth to it rather than creating a duplicate row.
        const existing = await repo.getUserByEmail(user.email!)
        if (existing && !existing.oauthSub) {
          await repo.linkOAuthAccount(existing.id, oauthSub)
          user.id = existing.id
          user.isActive = existing.isActive
          user.isAdmin = existing.isAdmin
          user.timezone = existing.timezone
          ;(user as any).sex = existing.sex ?? null
          ;(user as any).heightCm = existing.heightCm ?? null
          ;(user as any).dateOfBirth = existing.dateOfBirth ?? null
          ;(user as any).activityLevel = existing.activityLevel ?? null
          ;(user as any).friendCode = existing.friendCode ?? null
          ;(user as any).equippedTitle = existing.equippedTitle ?? null
          if (!existing.isActive) return "/pending"
          return true
        }

        const invited = await repo.isInvited(user.email!)
        const dbUser = await repo.upsertUser(
          { oauthSub, email: user.email!, name: user.name ?? undefined, timezone: 'Australia/Brisbane' },
          invited,
        )
        user.id = dbUser.id
        user.isActive = dbUser.isActive
        user.isAdmin = dbUser.isAdmin
        user.timezone = dbUser.timezone
        ;(user as any).sex = (dbUser as any).sex ?? null
        ;(user as any).heightCm = dbUser.heightCm ?? null
        ;(user as any).dateOfBirth = dbUser.dateOfBirth ?? null
        ;(user as any).activityLevel = dbUser.activityLevel ?? null
        ;(user as any).friendCode = dbUser.friendCode ?? null
        ;(user as any).equippedTitle = dbUser.equippedTitle ?? null
        if (!dbUser.isActive) return "/pending"
      }

      if (account?.provider === "credentials") {
        if (!user.isActive) return "/pending"
      }

      return true
    },
  },
})

export const { handlers, signIn, signOut } = nextAuth

/**
 * PS-24 — the enforcement point reads the row, not the claim.
 *
 * `middleware.ts` builds its own NextAuth instance from `auth.config.ts`, whose jwt callback has no
 * refresh, so the `isActive` it gates on is whatever was stamped at sign-in — and the Edge
 * middleware re-signs that stale claim with a fresh expiry on every request. Deactivating a
 * signed-in account therefore changed nothing: measured live, the existing cookie kept answering
 * 200 on `/api/friends` while a fresh sign-in was correctly sent to `/pending`. LA-58's 403 gate
 * works; the value it reads never moved.
 *
 * The fix costs no extra database work, because the read is already happening. `isActiveCheckedAt`
 * lives only in the token, the token never persists, so `refreshIsActiveClaim`'s once-a-day throttle
 * never engages and the users row is re-read on every authenticated request. The true value has
 * been sitting in `session.isActive` the whole time with nothing consulting it. This consults it.
 *
 * **Returning null rather than stripping `user.id`.** A session object present but missing its id is
 * a state none of the 213 route handlers were written for: 81 guard on `session?.user?.id`, and the
 * rest read it in shapes that would reach the driver as `undefined` — an unscoped or malformed
 * query, which is a worse outcome than the staleness. `null` is the not-signed-in state every
 * caller already handles, so this adds no new state to the app.
 *
 * The middleware's 403 is deliberately left in place. It is the cheaper answer whenever the cookie
 * itself already says inactive, and it is the only one that can distinguish "deactivated" from
 * "not signed in" for a client. Where the cookie is stale, a caller now gets 401, re-authenticates,
 * and `signIn` sends it to `/pending` — which terminates rather than loops, because sign-in does not
 * mint a session for an inactive account.
 *
 * Fails **open** on a database blip, matching `refreshIsActiveClaim`'s own catch: if the lookup
 * throws, the claim stands and nobody is signed out by an outage.
 *
 * `handlers` is deliberately NOT wrapped — those routes are how a session comes to exist.
 */
export const auth = (async (...args: Parameters<typeof nextAuth.auth>) => {
  const session = await (nextAuth.auth as (...a: unknown[]) => Promise<Session | null>)(...args)
  if (session?.isActive === false) return null
  return session
}) as typeof nextAuth.auth
