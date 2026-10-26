/**
 * PS-39 — the NextAuth handler re-export, `auth/[...nextauth]`.
 *
 * **On the NextAuth route, plainly: it is two lines** — `export const { GET, POST } = handlers` —
 * so there is nothing to test but that both verbs are exported and reachable. That is what the case
 * below asserts and all it claims. It counts on the ratchet because the ratchet asks whether a test
 * imports the handler, and a route that re-exports someone else's handler still fails to build if
 * the import breaks. Writing more would be inventing coverage.
 *
 * (This file also covered the step-counter-export, workout-sensors and comparison-harness probes
 * until they were retired in #2862.)
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/auth', () => ({
  // What `app/api/auth/[...nextauth]/route.ts` re-exports.
  handlers: { GET: async () => new Response('ok'), POST: async () => new Response('ok') },
}))

import { GET as authGet, POST as authPost } from '@/app/api/auth/[...nextauth]/route'

describe('/api/auth/[...nextauth]', () => {
  it('re-exports both of NextAuth’s handlers', async () => {
    // The whole route is `export const { GET, POST } = handlers`. There is nothing else to assert,
    // and this is not a claim that authentication works — only that both verbs are exported and
    // reachable, which is what breaks if the import or the destructuring is wrong.
    expect(typeof authGet).toBe('function')
    expect(typeof authPost).toBe('function')
    const { NextRequest } = await import('next/server')
    expect((await authGet(new NextRequest('http://localhost/api/auth/session'))).status).toBe(200)
    expect((await authPost(new NextRequest('http://localhost/api/auth/signout', { method: 'POST' }))).status).toBe(200)
  })
})
