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
  },
})

export const { handlers, signIn, signOut } = nextAuth

export async function auth(): Promise<Session | null> {
  const session = await nextAuth.auth()
  if (session) {
    if (!session.user?.id) {
      return null
    }
    const claims = await refreshIsActiveClaim({ userId: session.user.id, isActive: session.isActive, isAdmin: session.user.isAdmin }, lookupUser)
    if (!claims.isActive) {
      return null
    }
    session.isActive = true
    session.user.isAdmin = claims.isAdmin
    return session
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
