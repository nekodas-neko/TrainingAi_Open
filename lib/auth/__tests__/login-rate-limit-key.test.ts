import { describe, it, expect, vi, beforeEach } from 'vitest'
const rateLimit = vi.fn<(key: string) => boolean>(() => true)
const getUserByEmail = vi.fn(async () => null)
let capturedAuthorize: ((c: unknown, r: Request) => Promise<unknown>) | undefined

vi.mock('@/lib/rate-limit', () => ({ rateLimit }))
vi.mock('@/lib/data', () => ({ getRepositoryAsync: vi.fn(async () => ({ getUserByEmail })) }))
vi.mock('next-auth/providers/google', () => ({ default: vi.fn(() => ({ id: 'google' })) }))
vi.mock('next-auth/providers/credentials', () => ({
  default: vi.fn((config: { authorize: (c: unknown, r: Request) => Promise<unknown> }) => {
    capturedAuthorize = config.authorize
    return { id: 'credentials', ...config }
  }),
}))
vi.mock('next-auth', () => ({
  default: vi.fn(() => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })),
}))
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
  it('still folds case', async () => {
    await attempt('User@X.com')
    expect(keysMatching('login:')).toEqual(['login:user@x.com'])
  })

  it('looks the user up by that same normalised string', async () => {
    await attempt('  User@X.com  ')
    expect(getUserByEmail).toHaveBeenCalledWith('user@x.com')
  })

  it('adds a per-IP bucket, which no per-email limit can see', async () => {
    for (let i = 0; i < 3; i++) await attempt(`victim${i}@x.com`)
    expect(new Set(keysMatching('login:')).size).toBe(3)
    expect(new Set(keysMatching('login-ip:'))).toEqual(new Set(['login-ip:203.0.113.9']))
  })
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
    expect(keysMatching('login:')).toEqual([])
  })
})
