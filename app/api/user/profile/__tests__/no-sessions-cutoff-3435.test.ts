// #3435 (item 7): the profile responses spread the whole user row, which now carries `sessionsValidFrom`,
// the server's own sign-in cutoff. Nothing on the client reads it (the device compares
// `/api/account/data-epoch`), so it is not sent.
import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

const user = {
  id: 'u1', email: 'a@b.c', displayName: 'A', timezone: 'Australia/Brisbane',
  sessionsValidFrom: new Date('2026-10-26T01:00:00Z'),
}
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u1' } }) }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getUserCredentials: async () => ({ ...user, passwordHash: 'h' }),
    getUserProviders: async () => [],
    updateUserProfile: async () => ({ ...user }),
  }),
}))

import { GET, PATCH } from '../route'

describe('/api/user/profile (#3435)', () => {
  it('GET leaves the sign-in cutoff and the password hash out', async () => {
    const body = await (await GET()).json()
    expect(body.user.id).toBe('u1')
    expect(body.user).not.toHaveProperty('sessionsValidFrom')
    expect(body.user).not.toHaveProperty('passwordHash')
    expect(body.hasPassword).toBe(true)
  })

  it('PATCH leaves the sign-in cutoff out', async () => {
    const res = await PATCH(new NextRequest('http://localhost/api/user/profile', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'B' }),
    }))
    const body = await res.json()
    expect(body.user.id).toBe('u1')
    expect(body.user).not.toHaveProperty('sessionsValidFrom')
  })
})
