import { describe, it, expect, vi, beforeEach } from 'vitest'

// PS-25. The login limiter keyed on `email.toLowerCase()` while the lookup used
// `email.toLowerCase().trim()`. Two derivations of "the same email", so ` user@x` and `user@x `
// were fresh 20-attempt buckets against one account. Verified live before the fix: after 20 misses,
// attempt 21 (plain, correct password) was refused and attempt 22 (one leading space, correct
// password) signed in. Case was folded — the control — and whitespace was not.
//
// These tests assert the KEYS the limiter is called with, because that is the defect. Asserting
// only "the 21st attempt fails" would pass on the broken version too, as long as the test never
// padded the address.

const rateLimit = vi.fn(() => true)
const getUserByEmail = vi.fn(async () => null)
let capturedAuthorize: ((c: unknown, r: Request) => Promise<unknown>) | undefined

vi.mock('@/lib/rate-limit', () => ({ rateLimit }))
vi.mock('@/lib/data', () => ({ getRepositoryAsync: vi.fn(async () => ({ getUserByEmail })) }))
vi.mock('next-auth/providers/google', () => ({ default: vi.fn(() => ({ id: 'google' })) }))
vi.mock('next-auth/providers/credentials', () => ({
  // Hand the config straight back so the test can call `authorize` itself.
  default: vi.fn((config: { authorize: (c: unknown, r: Request) => Promise<unknown> }) => {
    capturedAuthorize = config.authorize
    return { id: 'credentials', ...config }
  }),
}))
vi.mock('next-auth', () => ({
  default: vi.fn(() => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })),
}))

// With one trusted proxy (Railway's shape, the `clientIp` default) the client is the RIGHTMOST
// entry — the one that proxy wrote. Anything to its left is caller-supplied.
const XFF = { 'x-forwarded-for': '10.0.0.99, 203.0.113.9' }

async function attempt(email: string, headers: Record<string, string> = XFF) {
  await import('@/auth')
  return capturedAuthorize!({ email, password: 'pw' }, new Request('http://x', { headers }))
}
const keysMatching = (prefix: string) =>
  rateLimit.mock.calls.map(c => c[0] as string).filter(k => k.startsWith(prefix))

describe('the login limiter keys on the same string the lookup uses (PS-25)', () => {
  beforeEach(() => { rateLimit.mockClear(); rateLimit.mockReturnValue(true); getUserByEmail.mockClear() })

  it('gives padded and unpadded forms of one address the same bucket', async () => {
    for (const variant of ['user@x.com', ' user@x.com', 'user@x.com ', '  USER@x.com  ', '\tuser@x.com\n']) {
      await attempt(variant)
    }
    expect(new Set(keysMatching('login:'))).toEqual(new Set(['login:user@x.com']))
  })

  // The half that was already right, kept so a future change cannot quietly drop it while
  // "fixing" whitespace.
  it('still folds case', async () => {
    await attempt('User@X.com')
    expect(keysMatching('login:')).toEqual(['login:user@x.com'])
  })

  it('looks the user up by that same normalised string', async () => {
    await attempt('  User@X.com  ')
    expect(getUserByEmail).toHaveBeenCalledWith('user@x.com')
  })

  it('adds a per-IP bucket, which no per-email limit can see', async () => {
    // Spraying: fifty different accounts from one source never fills any single email bucket.
    for (let i = 0; i < 3; i++) await attempt(`victim${i}@x.com`)
    expect(new Set(keysMatching('login:')).size).toBe(3)
    expect(new Set(keysMatching('login-ip:'))).toEqual(new Set(['login-ip:203.0.113.9']))
  })

  // Q-493: a proxy APPENDS the peer it heard from, so the leftmost entry is whatever the caller
  // sent. Keying on it lets the caller pick its own bucket and the limit does nothing.
  it('takes the IP from the right, so the caller cannot choose its own bucket', async () => {
    const keys = new Set<string>()
    for (const spoof of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      rateLimit.mockClear()
      await attempt('user@x.com', { 'x-forwarded-for': `${spoof}, 203.0.113.9` })
      keysMatching('login-ip:').forEach(k => keys.add(k))
    }
    expect(keys, 'a caller rotating the leftmost hop must not rotate its own bucket')
      .toEqual(new Set(['login-ip:203.0.113.9']))
  })

  it('refuses before touching the database when the IP bucket is full', async () => {
    rateLimit.mockImplementation((key: string) => !key.startsWith('login-ip:'))
    expect(await attempt('user@x.com')).toBeNull()
    expect(getUserByEmail).not.toHaveBeenCalled()
    // And without spending the victim's own bucket on someone else's spray.
    expect(keysMatching('login:')).toEqual([])
  })
})
