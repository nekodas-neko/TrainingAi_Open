// #3949 review N1: a web sign-in's `signedInAt` comes from the database clock (`signInStampFor`), the
// clock the sign-in cut-off is written with, for every provider. The Node instance's jwt callback
// replaces the edge config's app-clock stamp at sign-in, and only at sign-in.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const captured = vi.hoisted(() => ({
  config: null as null | { callbacks: { jwt: (p: Record<string, unknown>) => Promise<Record<string, unknown>> } },
  stamp: vi.fn(async (_id: string) => 1_900_000_000),
}))
vi.mock('next-auth', () => ({
  default: vi.fn((config: typeof captured.config) => {
    captured.config = config
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }
  }),
}))
vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn(() => ({})) }))
vi.mock('next-auth/providers/google', () => ({ default: vi.fn(() => ({})) }))
vi.mock('@/lib/data', () => ({
  getRepositoryAsync: vi.fn(async () => ({ signInStampFor: (id: string) => captured.stamp(id) })),
}))

describe('auth.ts jwt callback', () => {
  beforeEach(() => captured.stamp.mockClear())

  it('stamps a sign-in from the database, for the signed-in user', async () => {
    await import('@/auth')
    const token = await captured.config!.callbacks.jwt({ token: {}, user: { id: 'u-3949', isActive: true } })
    expect(captured.stamp).toHaveBeenCalledWith('u-3949')
    expect(token.signedInAt).toBe(1_900_000_000)
  })

  it('leaves a re-issued token\'s stamp alone (no user: not a sign-in)', async () => {
    await import('@/auth')
    const token = await captured.config!.callbacks.jwt({ token: { userId: 'u-3949', signedInAt: 1_700_000_000 } })
    expect(captured.stamp).not.toHaveBeenCalled()
    expect(token.signedInAt).toBe(1_700_000_000)
  })

  it('fails the sign-in when the stamp cannot be read', async () => {
    await import('@/auth')
    captured.stamp.mockRejectedValueOnce(new Error('db down'))
    await expect(captured.config!.callbacks.jwt({ token: {}, user: { id: 'u-3949' } })).rejects.toThrow('db down')
  })
})
