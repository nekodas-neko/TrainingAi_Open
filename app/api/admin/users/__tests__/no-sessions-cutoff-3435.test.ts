// #3435 (item 7): the admin listing spread each user row, `sessionsValidFrom` included. The admin
// screen does not read it, so the listing does not send it.
import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'admin', isAdmin: true } }) }))
vi.mock('@/lib/admin', async orig => ({ ...(await orig<typeof import('@/lib/admin')>()), requireAdmin: async () => undefined }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    listUsers: async () => [
      { id: 'u1', email: 'a@b.c', isActive: true, sessionsValidFrom: new Date('2026-10-26T01:00:00Z') },
      { id: 'u2', email: 'd@e.f', isActive: false, sessionsValidFrom: null },
    ],
    usersWithData: async () => new Set(['u2']),
  }),
}))

import { GET } from '../route'

describe('GET /api/admin/users (#3435)', () => {
  it('lists users without their sign-in cutoff, and still says which inactive ones hold data', async () => {
    const { users } = await (await GET(new NextRequest('http://localhost/api/admin/users'))).json()
    expect(users.map((u: { id: string }) => u.id)).toEqual(['u1', 'u2'])
    for (const u of users) expect(u).not.toHaveProperty('sessionsValidFrom')
    expect(users.map((u: { hasData: boolean }) => u.hasData)).toEqual([false, true])
  })
})
