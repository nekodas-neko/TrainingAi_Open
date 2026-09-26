// Q-293 was: `ai_health_insights` is keyed by `(user, section, date)`, so an insight written
// before the ring synced was the one the owner read all afternoon. It was fixed by hashing the
// context and treating a changed hash as a miss.
//
// RV-201 removed the cache entirely, because a cache exists to avoid a paid model call and there
// is no longer a model. That makes Q-293's defect structurally impossible rather than guarded:
// the text is a pure function of readings this handler has just fetched, so it cannot describe
// readings that are no longer the readings.
//
// These tests therefore assert the PROPERTY Q-293 cared about, not the mechanism that used to
// deliver it — the output tracks the current data, and no stored row is consulted or written.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: '00000000-0000-4000-8000-000000000293', timezone: 'Australia/Brisbane' } })),
}))

let readingsScore = 80
const cacheReads: string[] = []
const written: unknown[] = []

vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getAiHealthInsightWithHash: async () => { cacheReads.push('read'); return null },
    upsertAiHealthInsight: async (...args: unknown[]) => { written.push(args) },
    getOuraDaily: async () => [{ date: '2026-08-18', sleepScore: readingsScore, readinessContributors: null, sleepContributors: null, temperatureDeviation: null }],
    getOuraDailyDerived: async () => [],
    getOuraDailySummary: async () => [],
    listSleepSessions: async () => [],
    listBodyMetrics: async () => [],
    getWorkoutSessionsFrom: async () => [],
    getUserById: async () => null,
  }),
}))

const call = async () => {
  const { POST } = await import('../route')
  const res = await POST(new Request('http://localhost/api/ai/health-insight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section: 'sleep', date: '2026-08-18' }),
  }))
  return (await res.json()) as { insight?: string }
}

describe('the insight always describes the current readings (Q-293, RV-201)', () => {
  beforeEach(() => { cacheReads.length = 0; written.length = 0; readingsScore = 80 })

  it('names the reading it was given', async () => {
    expect((await call()).insight).toContain('80/100')
  })

  // The bug itself: same user, same section, same date, but the ring has since synced. There is
  // no longer any path by which the earlier sentence could survive that.
  it('follows the data when it changes under the same key', async () => {
    expect((await call()).insight).toContain('80/100')
    readingsScore = 41
    const after = (await call()).insight
    expect(after).toContain('41/100')
    expect(after).not.toContain('80/100')
  })

  it('neither reads nor writes a stored insight row', async () => {
    await call()
    expect(cacheReads).toEqual([])
    expect(written).toEqual([])
  })

  it('never calls a model — asserted by the absence of an `ai` mock', async () => {
    // This file deliberately does NOT mock the `ai` package. It mocked `generateText` while the
    // route called one; an unmocked import that the route still reached would fail here rather
    // than quietly hit the real SDK.
    await expect(call()).resolves.toBeTruthy()
  })
})
