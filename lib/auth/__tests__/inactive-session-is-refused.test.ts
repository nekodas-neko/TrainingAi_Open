import { describe, it, expect, vi, beforeEach } from 'vitest'

// PS-24. Deactivating a signed-in account did nothing: `middleware.ts` builds its own NextAuth
// instance from the Edge config, whose jwt callback has no refresh, so LA-58's 403 gate reads a
// claim stamped at sign-in and re-signed with a fresh expiry on every request. Measured live —
// the existing cookie kept answering 200 on `/api/friends`, while a fresh sign-in was correctly
// sent to `/pending`.
//
// The value itself was never stale. `auth.ts`'s jwt callback re-reads the users row on every
// authenticated request, so `session.isActive` has been true-to-the-database the whole time with
// nothing consulting it. These tests pin the consulting.

const baseAuth = vi.fn()

vi.mock('next-auth', () => ({
  default: vi.fn(() => ({ handlers: {}, auth: baseAuth, signIn: vi.fn(), signOut: vi.fn() })),
}))
vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn(() => ({})) }))
vi.mock('next-auth/providers/google', () => ({ default: vi.fn(() => ({})) }))
vi.mock('@/lib/data', () => ({ getRepositoryAsync: vi.fn(async () => ({})) }))

const ACTIVE = { user: { id: 'u1' }, isActive: true }
const INACTIVE = { user: { id: 'u1' }, isActive: false }

describe('auth() refuses a session the database says is inactive (PS-24)', () => {
  beforeEach(() => { baseAuth.mockReset() })

  it('returns null for an inactive session', async () => {
    baseAuth.mockResolvedValue(INACTIVE)
    const { auth } = await import('@/auth')
    expect(await auth()).toBeNull()
  })

  it('passes an active session through unchanged', async () => {
    baseAuth.mockResolvedValue(ACTIVE)
    const { auth } = await import('@/auth')
    expect(await auth()).toBe(ACTIVE)
  })

  // The 213 route handlers guard on `session?.user?.id`. Returning a session object with the id
  // removed would leave 132 of them reading `undefined` into a query — an unscoped or malformed
  // one, which is worse than the staleness this fixes. `null` is the not-signed-in state they all
  // already handle, so this introduces no new state.
  it('returns null rather than a session missing its id', async () => {
    baseAuth.mockResolvedValue(INACTIVE)
    const { auth } = await import('@/auth')
    const session = await auth()
    expect(session).toBeNull()
    expect(session?.user).toBeUndefined()
  })

  // `refreshIsActiveClaim` swallows a lookup failure and leaves the claim alone, so a database blip
  // must not sign everyone out. An undefined `isActive` is that case, and it passes.
  it('fails open when the claim is absent', async () => {
    const noClaim = { user: { id: 'u1' } }
    baseAuth.mockResolvedValue(noClaim)
    const { auth } = await import('@/auth')
    expect(await auth()).toBe(noClaim)
  })

  it('passes null through when there is no session at all', async () => {
    baseAuth.mockResolvedValue(null)
    const { auth } = await import('@/auth')
    expect(await auth()).toBeNull()
  })
})
