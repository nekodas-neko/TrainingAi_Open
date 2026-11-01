/**
 * #3383 — the prescription's `spo2Trend` compares only the device in use's nights (#3001), the way
 * `hrvTrend` does. The ring's uncalibrated SpO2 reads lower than Oura's, so a week of Oura after a
 * week of the ring looked like a drop in the person when it was a change in the ruler.
 *
 * The repository is a stub, like prescription-oura-switch-3077.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { aggregateSignals } from '../signals'

const TZ = 'Australia/Brisbane'
const USER = 'u-3383'
const SESSION = 'ps-1'
const today = todayInTz(TZ)
const day = (offset: number) => shiftDateStr(today, offset)

const stored: { bodyMetrics?: unknown[] } = {}
const repo = new Proxy({
  getActiveProgram: vi.fn(async () => ({
    id: 'p-1', trainingGoal: 'strength', autoApplyPrescriptions: false, startedAt: new Date(Date.now() - 90 * 86_400_000),
    sessions: [{ id: SESSION, name: 'Lower', exercises: [], timeBudgetMinutes: 60 }],
  })),
  getSessionPeriodization: vi.fn(async () => ({ phase: 'accumulation', sessionsInPhase: 2 })),
  reconcileSessionsInPhase: vi.fn(async () => undefined),
  getOuraCloudSwitchDay: vi.fn(async () => null),
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

const night = (offset: number, spo2Pct: number, spo2Source: string) => ({ date: day(offset), spo2Pct, spo2Source })
const signals = async () => (await aggregateSignals(USER, SESSION, repo, TZ))!

beforeEach(() => { delete stored.bodyMetrics })

describe('prescription spo2Trend reads one device (#3383)', () => {
  it('is unknown while the device in use has fewer than four nights, whatever the other device logged', async () => {
    // Seven ring nights at 94, then three Oura nights at 98: pooled, this read as a +4% rise.
    stored.bodyMetrics = [
      ...[-9, -8, -7, -6, -5, -4, -3].map(o => night(o, 94, 'oura_ble')),
      ...[-2, -1, 0].map(o => night(o, 98, 'oura_cloud')),
    ]
    expect((await signals()).spo2Trend).toBeNull()
  })

  it("compares Oura's recent nights with Oura's own earlier ones, ignoring the ring's", async () => {
    stored.bodyMetrics = [
      ...[-9, -8, -7].map(o => night(o, 94, 'oura_ble')),
      ...[-5, -4].map(o => night(o, 98, 'oura_cloud')),
      ...[-2, -1, 0].map(o => night(o, 96, 'oura_cloud')),
    ]
    // recent 3 = 96, older = Oura's 98, 98 only
    expect((await signals()).spo2Trend).toBeCloseTo(96 / 98, 6)
  })

  it('still reads a single device as before', async () => {
    stored.bodyMetrics = [
      ...[-6, -5, -4, -3].map(o => night(o, 97, 'oura_ble')),
      ...[-2, -1, 0].map(o => night(o, 94, 'oura_ble')),
    ]
    expect((await signals()).spo2Trend).toBeCloseTo(94 / 97, 6)
  })
})
