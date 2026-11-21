// #3615 (owner, 19 Nov): shadow readiness drops a superseded temperature deviation, the rule the live
// composite applies (#3610). The old account's values neither join the normal nor score a night.
import { describe, expect, it } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import type { DailyTemperatureDeviation } from '@trainingai/shared/health/readiness-signals'
import { assembleShadowInputs, prepareShadowHistory, type ShadowRawHistory } from '../assemble'
import { SHADOW_MODEL_VERSION } from '../model'

const REKEY = '2026-07-07'
const day = (n: number) => shiftDateStr('2026-06-20', n)

const deviations = (): DailyTemperatureDeviation[] =>
  Array.from({ length: 40 }, (_, n) => {
    const date = day(n)
    return { date, deviationC: date <= REKEY ? 1.5 : 0.1 + (n % 3) * 0.05, source: 'oura_cloud', superseded: date <= REKEY }
  })

const raw = (temperatureDeviations: DailyTemperatureDeviation[]): ShadowRawHistory => ({
  tz: 'Australia/Brisbane', ageYears: 40, sleepSessions: [], bodyMetrics: [], dailySummaries: [], wear: [], derived: [],
  temperatureDeviations,
  workouts: [], program: null, setHr: [], zoneSeconds: null, unwellDates: new Set(), fuel: new Map(), weightVsPlan: new Map(),
})

describe('shadow readiness and temperature from before the re-key (#3615)', () => {
  it('is version 7 or later', () => {
    expect(SHADOW_MODEL_VERSION).toBeGreaterThanOrEqual(7)
  })

  it('keeps superseded deviations out of the shadow series, and keeps the rest', () => {
    const series = prepareShadowHistory(raw(deviations())).series['body.temperature']!
    expect(series.some(o => o.date <= REKEY)).toBe(false)
    expect(series.filter(o => o.date > REKEY).length).toBe(deviations().filter(t => t.date > REKEY).length)
  })

  it('the old account no longer shifts the normal a post-re-key night is scored against', () => {
    const scored = day(35)
    const withFlag = assembleShadowInputs(prepareShadowHistory(raw(deviations())), scored).units['body.temperature']
    const unflagged = assembleShadowInputs(
      prepareShadowHistory(raw(deviations().map(({ superseded: _s, ...t }) => t))), scored,
    ).units['body.temperature']
    expect(withFlag!.history.every(o => o.date > REKEY)).toBe(true)
    expect(unflagged!.history.some(o => o.date <= REKEY)).toBe(true)
  })

  it('a deviation without the flag still counts', () => {
    const series = prepareShadowHistory(raw([{ date: day(5), deviationC: 0.2, source: 'oura_cloud' }])).series['body.temperature']!
    expect(series).toHaveLength(1)
  })
})
