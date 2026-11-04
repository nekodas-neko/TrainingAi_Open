/**
 * #3601 — the prescription's `hrvTrend` and `spo2Trend` compare only nights of the device in use under
 * its newest algorithm version, read from the same night's sleep. One version: exactly as before.
 * Two: the earlier version's nights leave the comparison. Stub repository, as in
 * prescription-spo2-device-3383.test.ts; synthetic values and a generic source name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'
import { aggregateSignals } from '../signals'

const TZ = 'Australia/Brisbane'
const USER = 'u-3601'
const SESSION = 'ps-1'
const today = todayInTz(TZ)
const day = (offset: number) => shiftDateStr(today, offset)

const stored: { bodyMetrics?: unknown[]; sleep?: unknown[] } = {}
const repo = new Proxy({
  getActiveProgram: vi.fn(async () => ({
    id: 'p-1', trainingGoal: 'strength', autoApplyPrescriptions: false, startedAt: new Date(Date.now() - 90 * 86_400_000),
    sessions: [{ id: SESSION, name: 'Lower', exercises: [], timeBudgetMinutes: 60 }],
  })),
  getSessionPeriodization: vi.fn(async () => ({ phase: 'accumulation', sessionsInPhase: 2 })),
  reconcileSessionsInPhase: vi.fn(async () => undefined),
  getOuraCloudSwitchDay: vi.fn(async () => null),
  listBodyMetrics: vi.fn(async () => stored.bodyMetrics ?? []),
  listSleepSessions: vi.fn(async () => stored.sleep ?? []),
}, {
  get(target, prop: string) {
    if (prop in target) return target[prop as keyof typeof target]
    if (/^get(Exercise|Weekly)/.test(prop)) return async () => ({})
    if (prop === 'getTimingAuditData') return async () => ({ sets: [], exercises: [], sessions: [] })
    if (/^get(MoodLog|DayCheckin)$/.test(prop)) return async () => null
    return async () => []
  },
}) as never

const SRC = 'source_a'
const metric = (offset: number, value: number) => ({ date: day(offset), hrvMs: value, hrvSource: SRC, spo2Pct: value, spo2Source: SRC })
/** Only the version matters to these readers; the rest of the night is left out. */
const night = (offset: number, version: string) => ({ date: day(offset), durationSource: SRC, sourceAlgorithmVersion: version })
const signals = async () => (await aggregateSignals(USER, SESSION, repo, TZ))!

const OLD = [-9, -8, -7, -6, -5]
const NEW_OLDER = [-4, -3]
const RECENT = [-2, -1, 0]

beforeEach(() => {
  stored.bodyMetrics = [...OLD.map(o => metric(o, 90)), ...NEW_OLDER.map(o => metric(o, 96)), ...RECENT.map(o => metric(o, 94))]
})

describe('prescription trends keyed by algorithm version (#3601)', () => {
  it('one version: the same trends as with no version stored', async () => {
    stored.sleep = []
    const before = await signals()
    stored.sleep = [...OLD, ...NEW_OLDER, ...RECENT].map(o => night(o, '1'))
    const after = await signals()
    expect(after.hrvTrend).toBeCloseTo(before.hrvTrend!, 9)
    expect(after.spo2Trend).toBeCloseTo(before.spo2Trend!, 9)
    // older = 90×5, 96×2 (newest 7 before the recent three)
    expect(after.spo2Trend).toBeCloseTo(94 / ((90 * 5 + 96 * 2) / 7), 6)
  })

  it('two versions: the earlier version’s nights leave the comparison', async () => {
    stored.sleep = [...OLD.map(o => night(o, '1')), ...[...NEW_OLDER, ...RECENT].map(o => night(o, '2'))]
    const s = await signals()
    expect(s.hrvTrend).toBeCloseTo(94 / 96, 6)
    expect(s.spo2Trend).toBeCloseTo(94 / 96, 6)
  })

  it('two versions, the new one with under four nights: unknown, never the old version’s', async () => {
    stored.sleep = [...[...OLD, ...NEW_OLDER].map(o => night(o, '1')), ...RECENT.map(o => night(o, '2'))]
    const s = await signals()
    expect(s.hrvTrend).toBeNull()
    expect(s.spo2Trend).toBeNull()
  })
})
