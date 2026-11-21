import { sessionFromToken } from '@/lib/auth/session'
import NextAuth, { type Session } from 'next-auth'
import { headers } from 'next/headers'
import { authConfig } from './auth.config'
import { credentialsProvider } from '@/lib/auth/credentials'
import { authorizeSignIn } from '@/lib/auth/sign-in'
import { refreshIsActiveClaim } from '@/lib/auth/is-active-refresh'
import { bearerSession } from '@/lib/auth/bearer-session'
import { getRepositoryAsync } from '@/lib/data'

async function lookupUser(userId: string) {
  const repository = await getRepositoryAsync()
  return repository.getUserById(userId)
}

const nextAuth = NextAuth({
  ...authConfig,
  providers: [...authConfig.providers, credentialsProvider],
  callbacks: {
    ...authConfig.callbacks,
    signIn: authorizeSignIn,
    // #3949 review N1: a sign-in's `signedInAt` comes from the database clock, the clock the sign-in
    // cut-off is written with, and is never below the account's cut-off (`signInStampFor`). The edge
    // config's callback stamps the app clock and cannot reach the database; this replaces that stamp
    // for every provider, at sign-in only (`user` is present only then), after `authorizeSignIn` and
    // any link it made have committed. A stamp that cannot be read fails the sign-in.
    async jwt(params) {
      const token = await authConfig.callbacks.jwt(params)
      if (params.user) {
        if (typeof token.userId !== 'string') throw new Error('Cannot stamp sign-in')
        token.signedInAt = await (await getRepositoryAsync()).signInStampFor(token.userId)
      }
      return token
    },
  },
})

export const { handlers, signIn, signOut } = nextAuth

export async function auth(): Promise<Session | null> {
  const session = await nextAuth.auth()
  if (session) {
    if (!session.user?.id) {
      return null
    }
    const claims = await refreshIsActiveClaim({ userId: session.user.id, isActive: session.isActive, isAdmin: session.user.isAdmin, signedInAt: session.signedInAt }, lookupUser)
    if (!claims.isActive) {
      return null
    }
    session.isActive = true
    session.user.isAdmin = claims.isAdmin
    return sessionFromToken(session, { ...session.user, ...claims })
  }

  let requestHeaders: Headers
  try {
    requestHeaders = await headers()
  } catch {
    return null
  }
  const bearer = await bearerSession(requestHeaders, lookupUser)
  return bearer?.isActive === true ? bearer : null
}
