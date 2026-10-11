import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUserById = vi.fn()
vi.mock('@/lib/data', () => ({ getRepository: async () => ({ getUserById }) }))

import { requireAdmin, isAdminUser, AdminError } from '../admin'

beforeEach(() => { getUserById.mockReset() })

describe('requireAdmin never trusts the claim', () => {
  it('refuses a revoked admin even when the caller insists the claim says admin', async () => {
    getUserById.mockResolvedValue({ id: 'u1', isActive: true, isAdmin: false })

    await expect(requireAdmin('u1', true)).rejects.toBeInstanceOf(AdminError)
    expect(getUserById).toHaveBeenCalledWith('u1')
  })

  it('reads the row on every call, so a freshly-granted admin is admitted without a new token', async () => {
    getUserById.mockResolvedValue({ id: 'u1', isActive: true, isAdmin: true })

    await expect(requireAdmin('u1', false)).resolves.toBeUndefined()
  })
})

describe('isAdminUser checks the database for pages and APIs', () => {
  it('refuses a stale claim', async () => {
    getUserById.mockResolvedValue({ id: 'u1', isActive: true, isAdmin: false })
    expect(await isAdminUser('u1', true)).toBe(false)
    expect(getUserById).toHaveBeenCalledWith('u1')
  })

  it('refuses an inactive administrator', async () => {
    getUserById.mockResolvedValue({ id: 'u1', isActive: false, isAdmin: true })
    expect(await isAdminUser('u1', true)).toBe(false)
    await expect(requireAdmin('u1')).rejects.toBeInstanceOf(AdminError)
  })
})
