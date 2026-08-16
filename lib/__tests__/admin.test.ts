import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUserById = vi.fn()
vi.mock('@/lib/data', () => ({ getRepository: async () => ({ getUserById }) }))

import { requireAdmin, AdminError } from '../admin'

beforeEach(() => getUserById.mockReset())

describe('requireAdmin', () => {
  it('resolves for an admin user', async () => {
    getUserById.mockResolvedValue({ id: 'u1', isAdmin: true })
    await expect(requireAdmin('u1')).resolves.toBeUndefined()
  })
  it('throws AdminError for a non-admin user', async () => {
    getUserById.mockResolvedValue({ id: 'u1', isAdmin: false })
    await expect(requireAdmin('u1')).rejects.toBeInstanceOf(AdminError)
  })
  it('throws AdminError for an empty userId without hitting the repo', async () => {
    await expect(requireAdmin('')).rejects.toBeInstanceOf(AdminError)
    expect(getUserById).not.toHaveBeenCalled()
  })
  it('ignores a stale JWT isAdmin=true flag — the DB is authoritative', async () => {
    getUserById.mockResolvedValue({ id: 'u1', isAdmin: false })
    await expect(requireAdmin('u1', true)).rejects.toBeInstanceOf(AdminError)
  })
})
