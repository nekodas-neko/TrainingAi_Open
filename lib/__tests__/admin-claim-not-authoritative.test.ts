// Q-479: `isAdminUser(userId, isAdmin)` returns the passed claim. That is fine for drawing an admin
// entry point and unsound for admitting a write, because the claim is refreshed at most once a day
// (`ISACTIVE_RECHECK_MS`). `app/api/exercises` passed it, so a revoked admin kept writing to the
// shared exercise catalogue for up to 24 hours.
//
// The two helpers disagree deliberately. These tests pin that disagreement, so neither drifts into
// the other: `isAdminUser` may shortcut, `requireAdmin` may not.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUserById = vi.fn()
vi.mock('@/lib/data', () => ({ getRepository: async () => ({ getUserById }) }))

import { requireAdmin, isAdminUser, AdminError } from '../admin'

beforeEach(() => { getUserById.mockReset() })

describe('requireAdmin never trusts the claim', () => {
  it('refuses a revoked admin even when the caller insists the claim says admin', async () => {
    getUserById.mockResolvedValue({ id: 'u1', isAdmin: false })

    await expect(requireAdmin('u1', true)).rejects.toBeInstanceOf(AdminError)
    expect(getUserById).toHaveBeenCalledWith('u1')
  })

  it('reads the row on every call, so a freshly-granted admin is admitted without a new token', async () => {
    getUserById.mockResolvedValue({ id: 'u1', isAdmin: true })

    await expect(requireAdmin('u1', false)).resolves.toBeUndefined()
  })
})

describe('isAdminUser shortcuts on the claim — which is why an API route must not pass it', () => {
  it('returns the claim without reading the row', async () => {
    expect(await isAdminUser('u1', true)).toBe(true)
    expect(getUserById).not.toHaveBeenCalled()
  })

  it('reads the row when no claim is supplied', async () => {
    getUserById.mockResolvedValue({ id: 'u1', isAdmin: false })

    expect(await isAdminUser('u1')).toBe(false)
    expect(getUserById).toHaveBeenCalledWith('u1')
  })
})
