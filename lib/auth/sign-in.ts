import type { Account, Profile, User } from 'next-auth'
import { cookies } from 'next/headers'
import { getRepositoryAsync } from '@/lib/data'
import { nativeLoginContinuation, readNativeTransaction, nativeSignInPath } from './mobile/native-transaction'
import { userClaims } from './user'

async function approvalRedirect(provider: 'google' | 'credentials', mobileState?: string) {
  const cookieStore = await cookies()
  const transaction = provider === 'google'
    ? await nativeLoginContinuation(cookieStore)
    : await readNativeTransaction(cookieStore)
  if (!transaction || (provider === 'credentials' && transaction.state !== mobileState)) {
    return '/pending'
  }
  return `${nativeSignInPath(transaction)}?error=account_pending`
}

/**
 * One rule for every provider's link and new-account paths (#3797 item 3, #3830): an invite activates
 * the account only when the provider is authoritative for the address. The caller decides what
 * "authoritative" means for its provider; an unauthoritative address never reaches the invite list.
 */
export async function inviteActivates(repository: { isInvited(email: string): Promise<boolean> }, email: string, authoritativeEmail: boolean) {
  return authoritativeEmail && await repository.isInvited(email)
}

async function googleUser(email: string, name: string | null | undefined, oauthSub: string, authoritativeEmail: boolean) {
  const repository = await getRepositoryAsync()
  const linked = await repository.getUserByOAuthSub(oauthSub)
  if (linked) {
    return linked
  }
  // One rule for both paths below (#3797 item 3): an invite activates the account only when Google
  // is authoritative for the address (`authorizeSignIn` has already required `email_verified`).
  const invited = () => inviteActivates(repository, email, authoritativeEmail)
  const existing = await repository.getUserByEmail(email)
  if (existing) {
    if (existing.oauthSub || !authoritativeEmail) {
      return null
    }
    if (!await repository.linkOAuthAccount(existing.id, oauthSub, { activate: await invited() })) {
      return repository.getUserByOAuthSub(oauthSub)
    }
    return repository.getUserById(existing.id)
  }

  return repository.upsertUser({
    oauthSub,
    email,
    name: name ?? undefined,
    timezone: 'Australia/Brisbane',
  }, await invited())
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
