// #2985: from the switch to the Oura API, Oura's `stress_high` is the daytime-stress input, taken as
// Oura calculated it and scored against its own `oura_cloud` normal; a day before the switch keeps
// our own figure, so no pre-switch day moves.
import { describe, it, expect } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { assembleShadowInputs, prepareShadowHistory, type ShadowRawHistory } from '../assemble'
import { scoreShadowReadiness } from '../score'

const SWITCH = '2026-10-18'
const D = '2026-10-20'

function raw(ouraCloudFrom: string | null): ShadowRawHistory {
  return {
    tz: 'Australia/Brisbane', ageYears: 40, sleepSessions: [], bodyMetrics: [], dailySummaries: [], workouts: [], program: null,
    setHr: [], zoneSeconds: null, unwellDates: new Set(), fuel: new Map(), weightVsPlan: new Map(),
    // Our own figure for the 30 days before the switch.
    derived: Array.from({ length: 30 }, (_, i) => ({ day: shiftDateStr(SWITCH, -(i + 1)), stressHighMinutes: 40 + (i % 5) })),
    // Oura's, in seconds: also on a day before the switch, where the frozen Cloud columns hold one.
    wear: [
      { date: shiftDateStr(SWITCH, -1), nonWearTimeSec: 0, stressHigh: 9_000 },
      { date: SWITCH, nonWearTimeSec: 0, stressHigh: 3_600 },
      { date: shiftDateStr(SWITCH, 1), nonWearTimeSec: 0, stressHigh: 5_400 },
    ],
    ouraCloudFrom,
  }
}

describe('daytime stress after the switch to the Oura API (#2985)', () => {
  it('reads Oura\'s stress_high in minutes, under its own source', () => {
    const prepared = prepareShadowHistory(raw(SWITCH))
    const unit = assembleShadowInputs(prepared, D).units['body.daytime_stress']!
    expect(unit.today).toMatchObject({ date: shiftDateStr(SWITCH, 1), value: 90, source: 'oura_cloud' })
  })

  it('leaves every day before the switch on our own figure', () => {
    const series = prepareShadowHistory(raw(SWITCH)).series['body.daytime_stress']!
    const before = series.filter(o => o.date < SWITCH)
    expect(before).toHaveLength(30)
    expect(before.every(o => o.source === 'oura_daily_derived')).toBe(true)
    expect(series.find(o => o.date === shiftDateStr(SWITCH, -1))?.value).toBe(40)
  })

  it('learns a normal of its own: our days do not count towards Oura\'s', () => {
    const r = scoreShadowReadiness(assembleShadowInputs(prepareShadowHistory(raw(SWITCH)), D))
    const unit = r.units['body.daytime_stress']
    expect(unit.provenance?.source).toBe('oura_cloud')
    expect(unit.validDays).toBeLessThanOrEqual(1)
  })

  it('without a switch, Oura\'s figure is never read', () => {
    const series = prepareShadowHistory(raw(null)).series['body.daytime_stress']!
    expect(series.every(o => o.source === 'oura_daily_derived')).toBe(true)
  })
})
