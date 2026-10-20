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
// #3176: the ring's rollup rows, the day the user switched to the Oura API, and Oura's own rows.
let summaries: Record<string, unknown>[] = []
let switchDay: string | null = null
let ouraRows: Record<string, unknown>[] | null = null

vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getOuraDaily: async () => ouraRows ?? [{
      date: DAY, readinessScore: 91, sleepScore: 87, activityScore: 83, temperatureDeviation: 0.4,
      readinessContributors: { hrv_balance: 13 }, sleepContributors: { deep_sleep: 17 },
    }],
    getOuraDailyDerived: async () => derived,
    getOuraDailySummary: async () => summaries,
    getOuraCloudSwitchDay: async () => switchDay,
    listSleepSessions: async () => [],
    listBodyMetrics: async () => [],
    getWorkoutSessionsFrom: async () => [],
    getUserById: async () => null,
    getUserGoals: async () => ({ stepsGoal: null }),
  }),
}))

const call = async (section: 'sleep' | 'readiness', date = DAY) => {
  const { POST } = await import('../route')
  const res = await POST(new Request('http://localhost/api/ai/health-insight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section, date }),
  }))
  return ((await res.json()) as { insight?: string }).insight ?? ''
}

describe("the health insight never presents Oura's scores as ours (#3000)", () => {
  beforeEach(() => { derived = []; summaries = []; switchDay = null; ouraRows = null })

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

  // #3176 (the switch-day rule, #2998): the ring's temperature stands only before the switch day.
  describe('temperature across the switch day (#3176)', () => {
    const oura = (date: string) => [{ date, temperatureDeviation: 0.4 }]

    it("an Oura-only day after the switch day reads Oura's temperature", async () => {
      switchDay = '2026-10-18'; ouraRows = oura('2026-10-19')
      expect(await call('readiness', '2026-10-19')).toContain("+0.4°C (Oura's reading)")
    })

    it("the switch day: a partial ring row loses to Oura's value", async () => {
      switchDay = '2026-10-18'; ouraRows = oura('2026-10-18')
      summaries = [{ date: '2026-10-18', tempDevC: -1.3 }]
      const text = await call('readiness', '2026-10-18')
      expect(text).toContain("+0.4°C (Oura's reading)")
      expect(text).not.toContain('-1.3')
    })

    it("before the switch day the ring's reading stands", async () => {
      switchDay = '2026-10-18'; ouraRows = oura('2026-10-17')
      summaries = [{ date: '2026-10-17', tempDevC: -0.6 }]
      expect(await call('readiness', '2026-10-17')).toContain('-0.6°C')
    })
  })
})
