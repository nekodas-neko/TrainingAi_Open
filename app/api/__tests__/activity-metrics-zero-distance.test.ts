// Q-41 finding 3: a GPS activity with two or more points that never moved computes a distance of
// exactly 0. `omitNullFields` does not strip a zero, so `.positive()` rejected the WHOLE payload —
// HR and calories included — for a legitimate reading. Same one-bad-field-kills-everything class
// as Q-36.
import { describe, it, expect, vi } from 'vitest'

const ID = '00000000-0000-4000-8000-0000000000a1'
const repo = vi.hoisted(() => ({ updateActivityLogMetrics: vi.fn(async () => true) }))

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'u1', timezone: 'Australia/Brisbane' } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    updateActivityLogMetrics: repo.updateActivityLogMetrics,
    getActivityLogById: async () => ({ id: ID, userId: 'u1', date: '2026-08-02', durationMin: 30, steps: null, distanceKm: null, caloriesBurned: null, avgHr: null, maxHr: null }),
  }),
}))

import { PATCH } from '@/app/api/activity-logs/[id]/metrics/route'

const patch = (body: unknown) => PATCH(
  new Request(`http://x/api/activity-logs/${ID}/metrics`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }),
  { params: Promise.resolve({ id: ID }) },
)

describe('PATCH /api/activity-logs/[id]/metrics — distance bounds', () => {
  it('accepts a zero-distance activity instead of rejecting the whole payload', async () => {
    const res = await patch({ distanceKm: 0, avgHr: 120, maxHr: 150 })
    expect(res.status).not.toBe(400)
  })

  it('still rejects a negative distance', async () => {
    expect((await patch({ distanceKm: -1 })).status).toBe(400)
  })

  it('still rejects an implausibly large distance', async () => {
    expect((await patch({ distanceKm: 501 })).status).toBe(400)
  })

  it('keeps calories strictly positive — a zero there means "not measured"', async () => {
    expect((await patch({ caloriesBurned: 0 })).status).toBe(400)
  })
})
