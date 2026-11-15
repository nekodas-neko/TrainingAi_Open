// #3797 item 3: on the link path, an invited address that Google verified is activated, exactly as
// a new Google account for it is; an uninvited one, an unverified Google email, or an address Google
// is not authoritative for, is not.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const repo = {
  getUserByOAuthSub: vi.fn(),
  getUserByEmail: vi.fn(),
  linkOAuthAccount: vi.fn(),
  getUserById: vi.fn(),
  isInvited: vi.fn(),
  upsertUser: vi.fn(),
}
vi.mock('@/lib/data', () => ({ getRepositoryAsync: async () => repo }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }) }))

import { authorizeSignIn } from '../sign-in'

const SUB = 'google-sub-1'
const signIn = (email: string, over: Record<string, unknown> = {}) => authorizeSignIn({
  user: { email, name: 'Sam' } as never,
  account: { provider: 'google', providerAccountId: SUB, type: 'oidc' } as never,
  profile: { sub: SUB, email, email_verified: true, ...over } as never,
})

beforeEach(() => {
  vi.clearAllMocks()
  repo.getUserByOAuthSub.mockResolvedValue(null)
  repo.getUserByEmail.mockResolvedValue({ id: 'u-1', email: 'sam@gmail.com', isActive: false })
  repo.linkOAuthAccount.mockResolvedValue(true)
  repo.getUserById.mockResolvedValue({ id: 'u-1', email: 'sam@gmail.com', isActive: true, isAdmin: false })
  repo.isInvited.mockResolvedValue(true)
  repo.upsertUser.mockResolvedValue({ id: 'u-2', email: 'new@gmail.com', isActive: true, isAdmin: false })
})

describe('#3797 — the link path honours the invite', () => {
  it('activates an invited, verified address on the link path', async () => {
    expect(await signIn('sam@gmail.com')).toBe(true)
    expect(repo.isInvited).toHaveBeenCalledWith('sam@gmail.com')
    expect(repo.linkOAuthAccount).toHaveBeenCalledWith('u-1', SUB, { activate: true })
  })
  it('does not activate an uninvited address', async () => {
    repo.isInvited.mockResolvedValue(false)
    repo.getUserById.mockResolvedValue({ id: 'u-1', email: 'sam@gmail.com', isActive: false, isAdmin: false })
    expect(await signIn('sam@gmail.com')).toBe('/pending')
    expect(repo.linkOAuthAccount).toHaveBeenCalledWith('u-1', SUB, { activate: false })
  })
  it('does not link or activate when Google has not verified the email', async () => {
    expect(await signIn('sam@gmail.com', { email_verified: false })).toBe(false)
    expect(repo.linkOAuthAccount).not.toHaveBeenCalled()
    expect(repo.isInvited).not.toHaveBeenCalled()
  })
  it('does not link an address Google is not authoritative for', async () => {
    repo.getUserByEmail.mockResolvedValue({ id: 'u-1', email: 'sam@example.com', isActive: false })
    expect(await signIn('sam@example.com')).toBe(false)
    expect(repo.linkOAuthAccount).not.toHaveBeenCalled()
  })
  it('the new-account path uses the same rule', async () => {
    repo.getUserByEmail.mockResolvedValue(null)
    await signIn('new@gmail.com')
    expect(repo.upsertUser).toHaveBeenCalledWith(expect.objectContaining({ oauthSub: SUB }), true)
    repo.isInvited.mockResolvedValue(false)
    await signIn('new@gmail.com')
    expect(repo.upsertUser).toHaveBeenLastCalledWith(expect.objectContaining({ oauthSub: SUB }), false)
    repo.isInvited.mockClear()
    await signIn('new@example.com')
    expect(repo.isInvited).not.toHaveBeenCalled()
    expect(repo.upsertUser).toHaveBeenLastCalledWith(expect.objectContaining({ oauthSub: SUB }), false)
  })
})
