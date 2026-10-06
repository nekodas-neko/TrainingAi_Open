import type { Account, Profile, User } from 'next-auth'
import { cookies } from 'next/headers'
import { getRepositoryAsync } from '@/lib/data'
import { iosLoginContinuation, readIosTransaction } from './mobile/ios-transaction'
import { userClaims } from './user'

async function approvalRedirect(provider: 'google' | 'credentials', mobileState?: string) {
  const cookieStore = await cookies()
  const transaction = provider === 'google'
    ? await iosLoginContinuation(cookieStore)
    : await readIosTransaction(cookieStore)
  if (!transaction || (provider === 'credentials' && transaction.state !== mobileState)) {
    return '/pending'
  }
  return '/mobile-signin/ios?error=account_pending'
}

async function googleUser(email: string, name: string | null | undefined, oauthSub: string, authoritativeEmail: boolean) {
  const repository = await getRepositoryAsync()
  const linked = await repository.getUserByOAuthSub(oauthSub)
  if (linked) {
    return linked
  }
  const existing = await repository.getUserByEmail(email)
  if (existing) {
    if (existing.oauthSub || (existing.isActive && !authoritativeEmail)) {
      return null
    }
    if (!await repository.linkOAuthAccount(existing.id, oauthSub)) {
      return repository.getUserByOAuthSub(oauthSub)
    }
    return repository.getUserById(existing.id)
  }

  const invited = authoritativeEmail && await repository.isInvited(email)
  return repository.upsertUser({
    oauthSub,
    email,
    name: name ?? undefined,
    timezone: 'Australia/Brisbane',
  }, invited)
}

export async function authorizeSignIn({ user, account, profile }: {
  user: User; account?: Account | null; profile?: Profile
}) {
  if (account?.provider === 'google') {
    if (!user.email || profile?.email_verified !== true || profile.sub !== account.providerAccountId) {
      return false
    }
    const authoritativeEmail = user.email.toLowerCase().endsWith('@gmail.com')
      || (typeof profile.hd === 'string' && profile.hd.length > 0)
    const storedUser = await googleUser(user.email, user.name, account.providerAccountId, authoritativeEmail)
    if (!storedUser) {
      return false
    }
    Object.assign(user, userClaims(storedUser))
    user.email = storedUser.email
    return user.isActive ? true : approvalRedirect('google')
  }
  if (account?.provider === 'credentials' && !user.isActive) {
    return approvalRedirect('credentials', user.mobileState)
  }
  return true
}
