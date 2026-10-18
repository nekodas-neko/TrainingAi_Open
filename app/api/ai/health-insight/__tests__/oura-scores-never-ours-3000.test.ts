// #3000 (scoring doc rule 5): Oura's top-level scores and contributors are never ours. With Oura's
// sleep score and contributors present and ours absent, the Sleep insight says nothing about a sleep
// score; with ours present, it is ours that is named. The readiness insight never reads Oura's
// readiness contributors. No model is called: this file does not mock `ai`.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: '00000000-0000-4000-8000-000000003000', timezone: 'Australia/Brisbane' } })),
}))

const DAY = '2026-10-17'
let derived: Record<string, unknown>[] = []

vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getOuraDaily: async () => [{
      date: DAY, readinessScore: 91, sleepScore: 87, activityScore: 83, temperatureDeviation: 0.4,
      readinessContributors: { hrv_balance: 13 }, sleepContributors: { deep_sleep: 17 },
    }],
    getOuraDailyDerived: async () => derived,
    getOuraDailySummary: async () => [],
    listSleepSessions: async () => [],
    listBodyMetrics: async () => [],
    getWorkoutSessionsFrom: async () => [],
    getUserById: async () => null,
    getUserGoals: async () => ({ stepsGoal: null }),
  }),
}))

const call = async (section: 'sleep' | 'readiness') => {
  const { POST } = await import('../route')
  const res = await POST(new Request('http://localhost/api/ai/health-insight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section, date: DAY }),
  }))
  return ((await res.json()) as { insight?: string }).insight ?? ''
}

describe("the health insight never presents Oura's scores as ours (#3000)", () => {
  beforeEach(() => { derived = [] })

  it("Sleep: Oura's score and contributors exist, ours don't → no score, never Oura's", async () => {
    const text = await call('sleep')
    expect(text).not.toContain('87')
    expect(text).not.toMatch(/deep sleep 17/i)
  })

  it('Sleep: our score and contributors are the ones named', async () => {
    derived = [{ day: DAY, sleepScore: 64, sleepContributors: { total_sleep: 58 } }]
    const text = await call('sleep')
    expect(text).toContain('64/100')
    expect(text).not.toContain('87')
  })

  it("Readiness: Oura's readiness and contributors are never read", async () => {
    const text = await call('readiness')
    expect(text).not.toContain('91')
    expect(text).not.toMatch(/\b13\/100/)
  })

  it("Readiness: Oura's temperature reading is labelled as Oura's, not as a stale value", async () => {
    const text = await call('readiness')
    expect(text).toContain("+0.4°C (Oura's reading)")
    expect(text).not.toContain('pre-re-key')
  })
})
