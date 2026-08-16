import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { getRepositoryAsync } from "@/lib/data"
import { authConfig } from "./auth.config"
import { rateLimit } from "@/lib/rate-limit"
import type { JWT } from "next-auth/jwt"
import { refreshIsActiveClaim } from "@/lib/auth/is-active-refresh"

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined
        const password = credentials?.password as string | undefined
        if (!email || !password) return null

        // 20 attempts per email per 15 minutes — prevents account-specific brute force
        if (!rateLimit(`login:${email.toLowerCase()}`, 20, 15 * 60 * 1000)) return null

        const repo = await getRepositoryAsync()
        const user = await repo.getUserByEmail(email.toLowerCase().trim())
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
