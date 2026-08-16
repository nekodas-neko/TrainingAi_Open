import type { NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"

// Edge-compatible config — no Node.js-only imports (no bcrypt, no pg).
// Middleware imports this directly. auth.ts merges it with the full Node.js config.
export const authConfig: NextAuthConfig = {
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
      if ('sex' in (user ?? {})) token.sex = (user as any).sex ?? null
      if ('heightCm' in (user ?? {})) token.heightCm = (user as any).heightCm ?? null
      if ('dateOfBirth' in (user ?? {})) token.dateOfBirth = (user as any).dateOfBirth ?? null
      if ('activityLevel' in (user ?? {})) token.activityLevel = (user as any).activityLevel ?? null
      if ('friendCode' in (user ?? {})) token.friendCode = (user as any).friendCode ?? null
      if ('equippedTitle' in (user ?? {})) token.equippedTitle = (user as any).equippedTitle ?? null
      if (account?.provider === "google" && account.refresh_token) {
        token.refreshToken = account.refresh_token as string
      }
      return token
    },
    session({ session, token }) {
      if (token.userId) session.user.id = token.userId
      if (token.refreshToken) session.refreshToken = token.refreshToken
      if (typeof token.isActive === "boolean") session.isActive = token.isActive
      if (typeof token.isAdmin === "boolean") session.user.isAdmin = token.isAdmin
      if (token.timezone) session.user.timezone = token.timezone
      session.user.sex = token.sex ?? null
      session.user.heightCm = token.heightCm ?? null
      session.user.dateOfBirth = token.dateOfBirth ?? null
      session.user.activityLevel = token.activityLevel ?? null
      session.user.friendCode = token.friendCode ?? null
      session.user.equippedTitle = token.equippedTitle ?? null
      return session
    },
  },
}
