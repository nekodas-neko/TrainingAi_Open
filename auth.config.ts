import type { NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"
import { sessionFromToken } from '@/lib/auth/session'

// Middleware dependencies must support the Edge runtime.
export const authConfig = {
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          access_type: "offline",
          prompt: "consent",
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/calendar.events",
          ].join(" "),
        },
      },
    }),
  ],
  callbacks: {
    jwt({ token, user, account }) {
      if (user?.id) token.userId = user.id
      if (typeof user?.isActive === "boolean") token.isActive = user.isActive
      if (typeof user?.isAdmin === "boolean") token.isAdmin = user.isAdmin
      if (user?.timezone) token.timezone = user.timezone
      if (user) {
        if ('sex' in user) token.sex = user.sex ?? null
        if ('heightCm' in user) token.heightCm = user.heightCm ?? null
        if ('dateOfBirth' in user) token.dateOfBirth = user.dateOfBirth ?? null
        if ('activityLevel' in user) token.activityLevel = user.activityLevel ?? null
        if ('friendCode' in user) token.friendCode = user.friendCode ?? null
        if ('equippedTitle' in user) token.equippedTitle = user.equippedTitle ?? null
      }
      if (account?.provider === "google" && account.refresh_token) {
        token.refreshToken = account.refresh_token
      }
      return token
    },
    session({ session, token }) {
      return sessionFromToken(session, token)
    },
  },
} satisfies NextAuthConfig
