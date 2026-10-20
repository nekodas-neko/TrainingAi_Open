/**
 * #3077 — the prescription's temperature and resilience signals across the switch to the Oura API.
 *
 * `tempZ` read only the ring's `oura_daily_summary`, which stopped on 17–18 Oct, so every
 * prescription after the switch was told "Skin temp deviation: no data". It now reads readiness
 * v8's per-input, per-device temperature: the ring's z where the ring has tonight (unchanged), else
 * Oura's deviation against earlier Oura nights. Resilience is the ring's 1–5 level only before the
 * switch day; from it the level is honestly absent (Oura's word is not mapped, #3212).
 *
 * The repository is a stub: every read the signals do not care about returns nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { illnessZScores } from '@trainingai/shared/health/illness-radar'
import { aggregateSignals } from '../signals'

const TZ = 'Australia/Brisbane'
const USER = 'u-3077'
const SESSION = 'ps-1'
const today = todayInTz(TZ)
const day = (offset: number) => shiftDateStr(today, offset)

const stored: Record<string, unknown[] | null> = {}
const repo = new Proxy({
  getActiveProgram: vi.fn(async () => ({
    id: 'p-1', trainingGoal: 'strength', autoApplyPrescriptions: false, startedAt: new Date(Date.now() - 90 * 86_400_000),
    sessions: [{ id: SESSION, name: 'Lower', exercises: [], timeBudgetMinutes: 60 }],
  })),
  getSessionPeriodization: vi.fn(async () => ({ phase: 'accumulation', sessionsInPhase: 2 })),
  reconcileSessionsInPhase: vi.fn(async () => undefined),
  getOuraCloudSwitchDay: vi.fn(async () => null as string | null),
  getOuraDailySummary: vi.fn(async () => stored.summaries ?? []),
  getOuraDaily: vi.fn(async () => stored.ouraDaily ?? []),
  getOuraDailyDerived: vi.fn(async () => stored.derived ?? []),
  listBodyMetrics: vi.fn(async () => stored.bodyMetrics ?? []),
}, {
  get(target, prop: string) {
    if (prop in target) return target[prop as keyof typeof target]
    if (/^get(Exercise|Weekly)/.test(prop)) return async () => ({})
    if (prop === 'getTimingAuditData') return async () => ({ sets: [], exercises: [], sessions: [] })
    if (/^get(MoodLog|DayCheckin)$/.test(prop)) return async () => null
    return async () => []
  },
}) as never

const baseline = (meanC: number) => ({ meanX8: Math.round(meanC * 100) * 8, devX8: 10 * 8 })
/** A ring summary night, temperature only. */
const ringNight = (date: string, tempMeanC: number | null, tempBaseline = baseline(36.2)) => ({
  date, tempMeanC, tempBaseline, tempDevC: tempMeanC != null ? +(tempMeanC - 36.2).toFixed(2) : null,
  rhrBaseline: null, hrvBaseline: null, breathBaseline: null, rhrLowBpm: null, hrvAvgMs: null, breathAvgRpm: null,
  nHistory: 40, sleepDurationHours: null, sleepBaseline: null, recoveryIndexHours: null,
})

const signals = async () => (await aggregateSignals(USER, SESSION, repo, TZ))!

beforeEach(() => {
  for (const k of Object.keys(stored)) delete stored[k]
  ;(repo as unknown as { getOuraCloudSwitchDay: ReturnType<typeof vi.fn> }).getOuraCloudSwitchDay.mockResolvedValue(null)
})
const setSwitchDay = (d: string | null) =>
  (repo as unknown as { getOuraCloudSwitchDay: ReturnType<typeof vi.fn> }).getOuraCloudSwitchDay.mockResolvedValue(d)

describe('prescription tempZ follows readiness v8 across the switch (#3077)', () => {
  it("before the switch day, the ring's z is unchanged", async () => {
    setSwitchDay(day(1))
    const prior = ringNight(day(-1), 36.25)
    const tonight = ringNight(day(0), 36.6)
    stored.summaries = [prior, tonight]
    const expected = illnessZScores(prior, tonight).tempZ
    expect(expected).not.toBeNull()
    expect((await signals()).tempZ).toBe(expected)
  })

  it("after the switch, an Oura-only night is judged against earlier Oura nights", async () => {
    setSwitchDay(day(-3))
    // The ring's last partial row, from the switch day, with nothing in it.
    stored.summaries = [ringNight(day(-3), null)]
    // 20 earlier Oura nights centred on zero, then a hot night.
    stored.ouraDaily = [
      ...Array.from({ length: 20 }, (_, i) => ({ date: day(-20 + i), temperatureDeviation: i % 2 ? 0.1 : -0.1 })),
      { date: today, temperatureDeviation: 0.6 },
    ]
    stored.bodyMetrics = [{ date: today, hrvMs: 50, hrvSource: 'oura_cloud' }]
    const { tempZ } = await signals()
    expect(tempZ).not.toBeNull()
    expect(tempZ!).toBeGreaterThan(2)
  })

  it('after the switch with too few Oura nights, it is absent rather than invented', async () => {
    setSwitchDay(day(-3))
    stored.ouraDaily = [{ date: day(-1), temperatureDeviation: 0 }, { date: today, temperatureDeviation: 0.6 }]
    stored.bodyMetrics = [{ date: today, hrvMs: 50, hrvSource: 'oura_cloud' }]
    expect((await signals()).tempZ).toBeNull()
  })
})

describe('prescription resilience stands only before the switch day (#3077)', () => {
  beforeEach(() => {
    stored.derived = [{ day: day(-1), resilienceLevel: 4 }, { day: today, resilienceLevel: 3 }]
  })

  it('with no switch, the latest ring level stands', async () => {
    expect((await signals()).resilienceLevel).toBe(3)
  })

  it('before the switch day, the latest ring level stands', async () => {
    setSwitchDay(day(1))
    expect((await signals()).resilienceLevel).toBe(3)
  })

  it("from the switch day, the ring's leftovers are not offered and the level is absent", async () => {
    setSwitchDay(day(-1))
    expect((await signals()).resilienceLevel).toBeNull()
  })

  it('a ring level from before the switch still stands the day after it', async () => {
    setSwitchDay(today)
    expect((await signals()).resilienceLevel).toBe(4)
  })
})
