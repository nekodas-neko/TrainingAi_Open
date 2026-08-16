import { describe, it, expect, vi, beforeEach } from 'vitest'

const createEmailUser = vi.fn(async () => ({ id: 'u-new', email: 'new@example.com', isActive: false }))
const getUserByEmail = vi.fn(async () => null)

vi.mock('@/lib/data', () => ({ getRepository: async () => ({ createEmailUser, getUserByEmail }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

import { POST } from '@/app/api/auth/register/route'

beforeEach(() => { createEmailUser.mockClear(); getUserByEmail.mockClear() })

function registerReq(body: object) {
  return new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never // route types the param as NextRequest; Request is runtime-compatible here
}

describe('register route — accounts must start inactive/pending', () => {
  it('never passes an isActive override to createEmailUser (activation stays with the invite check)', async () => {
    const res = await POST(registerReq({ email: 'new@example.com', password: 'longenough1', name: 'New' }))
    expect(res.status).toBe(200)
    expect(createEmailUser).toHaveBeenCalledTimes(1)
    const args = createEmailUser.mock.calls[0] as unknown[]
    expect(args[0]).toBe('new@example.com')
    expect(args[1]).not.toBe('longenough1')      // hashed, never plaintext
    expect(args.length).toBeLessThanOrEqual(3)    // no 4th isActive argument
    expect(args[3]).toBeUndefined()
  })
  it('rejects duplicate emails without creating a user', async () => {
    getUserByEmail.mockResolvedValueOnce({ id: 'u-existing' } as never)
    const res = await POST(registerReq({ email: 'new@example.com', password: 'longenough1' }))
    expect(res.status).toBe(409)
    expect(createEmailUser).not.toHaveBeenCalled()
  })
})
