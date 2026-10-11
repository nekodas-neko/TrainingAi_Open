import { describe, it, expect, vi, beforeEach } from 'vitest'

const baseAuth = vi.fn()

vi.mock('next-auth', () => ({
  default: vi.fn(() => ({ handlers: {}, auth: baseAuth, signIn: vi.fn(), signOut: vi.fn() })),
}))
vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn(() => ({})) }))
vi.mock('next-auth/providers/google', () => ({ default: vi.fn(() => ({})) }))
const getUserById = vi.fn(async () => ({ isActive: true, isAdmin: false }))
vi.mock('@/lib/data', () => ({ getRepositoryAsync: vi.fn(async () => ({ getUserById })) }))

const ACTIVE = { user: { id: 'u1' }, isActive: true }
const INACTIVE = { user: { id: 'u1' }, isActive: false }

describe('auth() refuses a session the database says is inactive (PS-24)', () => {
  beforeEach(() => { baseAuth.mockReset(); getUserById.mockReset(); getUserById.mockResolvedValue({ isActive: true, isAdmin: false }) })

  it('returns null for an inactive session', async () => {
    getUserById.mockResolvedValue({ isActive: false, isAdmin: false })
    baseAuth.mockResolvedValue(INACTIVE)
    const { auth } = await import('@/auth')
    expect(await auth()).toBeNull()
  })

  it('passes an active session through unchanged', async () => {
    baseAuth.mockResolvedValue(ACTIVE)
    const { auth } = await import('@/auth')
    expect(await auth()).toBe(ACTIVE)
  })
  it('returns null rather than a session missing its id', async () => {
    getUserById.mockResolvedValue({ isActive: false, isAdmin: false })
    baseAuth.mockResolvedValue(INACTIVE)
    const { auth } = await import('@/auth')
    const session = await auth()
    expect(session).toBeNull()
    expect(session?.user).toBeUndefined()
  })
  it('reads the database when the claim is absent', async () => {
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
