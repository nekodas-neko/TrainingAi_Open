// #3896 step 5 — a lift-preference apply has its own limit (10 a minute) on top of the route's, born
// with the domain. The real limiter; the write itself is stubbed, so no row is touched.
import { describe, it, expect, vi } from 'vitest'

const USER_ID = '00000000-0000-4000-8000-000000389661'
const T = '00000000-0000-4000-8000-000000389662'
const applyCoachPatch = vi.hoisted(() => vi.fn(async () => ({ ok: true, changeId: '00000000-0000-4000-8000-000000389663', summary: 's' })))

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER_ID, timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/data/postgres/client', () => ({ getDb: () => ({}), ensureSchema: async () => {} }))
vi.mock('@/lib/coach/apply', () => ({ applyCoachPatch }))

const body = (domain: string) => JSON.stringify(domain === 'lift_preference'
  ? { patch: { domain, targetId: T, changes: [{ id: 'c', field: 'nextLoadStep', from: null, to: 'lighter' }] }, acceptedChangeIds: ['c'] }
  : { patch: { domain, targetId: null, changes: [{ id: 'c', field: 'stepsGoal', from: 8000, to: 9000 }] }, acceptedChangeIds: ['c'] })

describe('/api/coach/apply lift_preference limit (#3896 step 5)', () => {
  it('the 11th lift-preference apply in a minute is 429 and never reaches the write; other domains are not counted', async () => {
    const { POST } = await import('@/app/api/coach/apply/route')
    const call = (domain: string) => POST(new Request('http://localhost/api/coach/apply', { method: 'POST', body: body(domain) }))
    for (let i = 0; i < 10; i++) expect((await call('lift_preference')).status).toBe(200)
    const writes = applyCoachPatch.mock.calls.length
    expect((await call('lift_preference')).status).toBe(429)
    expect(applyCoachPatch.mock.calls.length).toBe(writes)
    expect((await call('user_goals')).status).toBe(200)
  })
})
