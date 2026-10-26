// #3001: the shadow model's overnight-settling unit took the ring's hours only, so it was missing on
// every Oura night. It now takes Oura's recovery-index contributor where the ring's summary has no
// hours, as the live composite does, under its own device label so it is learned against Oura's own
// nights and never against the ring's hours.
import { describe, it, expect } from 'vitest'
import { shiftDateStr } from '@trainingai/shared/date-utils'
import { assembleShadowInputs, prepareShadowHistory, type ShadowRawHistory } from '../assemble'
import { scoreShadowReadiness } from '../score'

const D = '2026-10-24'

const summary = (date: string, hours: number | null) => ({ date, recoveryIndexHours: hours, tempDevC: null, breathAvgRpm: null })
const contributor = (date: string, v: number | null) => ({ date, readinessContributors: { recovery_index: v } })

function raw(over: Partial<ShadowRawHistory>): ShadowRawHistory {
  return {
    tz: 'Australia/Brisbane', ageYears: 40, sleepSessions: [], bodyMetrics: [], dailySummaries: [], wear: [], derived: [],
    workouts: [], program: null, setHr: [], zoneSeconds: null, unwellDates: new Set(), fuel: new Map(), weightVsPlan: new Map(),
    ...over,
  }
}

// Ring hours for 20 nights to 16 Oct, Oura contributors for 17-24 Oct (the switch).
const ringDays = Array.from({ length: 20 }, (_, i) => shiftDateStr('2026-10-16', -i))
const ouraDays = Array.from({ length: 8 }, (_, i) => shiftDateStr('2026-10-17', i))

describe('overnight settling on an Oura night (#3001)', () => {
  const history = raw({
    dailySummaries: ringDays.map(d => summary(d, 5 + (d.endsWith('3') ? 0.5 : 0))),
    ouraCloudContributors: ouraDays.map((d, i) => contributor(d, 70 + i)),
  })
  const series = prepareShadowHistory(history).series['heart.overnight_settling']!

  it('has the ring’s hours before the switch and Oura’s contributor after it, each under its own device', () => {
    expect(series.filter(o => o.source === 'oura_daily_summary')).toHaveLength(20)
    expect(series.filter(o => o.source === 'oura_cloud').map(o => o.date)).toEqual(ouraDays)
    expect(series.find(o => o.date === '2026-10-20')?.value).toBe(73)
  })

  it('prefers the ring’s hours on a night that has both', () => {
    const both = prepareShadowHistory(raw({
      dailySummaries: [summary('2026-10-20', 6.5)], ouraCloudContributors: [contributor('2026-10-20', 70)],
    })).series['heart.overnight_settling']!
    expect(both).toEqual([expect.objectContaining({ date: '2026-10-20', value: 6.5, source: 'oura_daily_summary' })])
  })

  it('scores an Oura night against Oura’s own nights only, with a floor in contributor points', () => {
    const r = scoreShadowReadiness(assembleShadowInputs(prepareShadowHistory(history), D))
    const unit = r.units['heart.overnight_settling']
    expect(unit.provenance?.source).toBe('oura_cloud')
    expect(unit.value).toBe(77)
    // Seven earlier Oura nights, none of the twenty ring nights.
    expect(unit.validDays).toBe(7)
    expect(prepareShadowHistory(history).series['heart.overnight_settling']!.find(o => o.date === D)?.minMeaningfulChange).toBe(5)
  })

  it('reads nothing on an Oura night with no contributor, and is unchanged without contributors', () => {
    const none = prepareShadowHistory(raw({ dailySummaries: [summary('2026-10-20', 6)] })).series['heart.overnight_settling']!
    expect(none).toHaveLength(1)
    expect(prepareShadowHistory(raw({ ouraCloudContributors: [contributor('2026-10-20', null)] })).series['heart.overnight_settling']).toEqual([])
  })
})
