import { describe, it, expect } from 'vitest'
import { mergeByDate, type SleepRow } from '@/lib/sleep/merge-sessions'
import { groupSleepPeriods, nightForDate, nightSessions, isOuraSecondaryPeriod } from '@trainingai/shared/health/sleep-night'

// #3057 / #3058. The night ending 19 Oct 2026 in production: two Oura Cloud periods, a 20-minute
// `sleep` fragment 23:05-23:25 Brisbane and the `long_sleep` main period 00:02-06:46, 37 minutes
// apart. Oura's `long_sleep` is the night; the fragment is a nap, for the card and for the score.

const TZ = 'Australia/Brisbane' // UTC+10, no DST
/** Brisbane wall-clock time as an ISO instant. */
const bne = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+10:00`).toISOString()

const row = (o: Partial<SleepRow> & { date: string; sleepStart: string; sleepEnd: string }): SleepRow => ({
  ouraId: null, durationHours: null, deepSleepHours: null, remSleepHours: null,
  lightSleepHours: null, awakHours: null, efficiency: null, onsetLatencySec: null,
  averageHrvMs: null, avgHeartRate: null, lowestHeartRate: null, restlessPeriods: null,
  respiratoryRate: null, sleepPhase5Min: null, sleepTimeRecommendation: null,
  ...o,
})

const fragment = row({
  date: '2026-10-19', ouraId: 'oura-fragment', ouraSleepType: 'sleep',
  sleepStart: bne('2026-10-18', '23:05'), sleepEnd: bne('2026-10-18', '23:25'),
  durationHours: 2 / 60, awakHours: 18 / 60, efficiency: 10, onsetLatencySec: 0,
  deepSleepHours: 0, remSleepHours: 1 / 60, lightSleepHours: 1 / 60,
})
const main = row({
  date: '2026-10-19', ouraId: 'oura-main', ouraSleepType: 'long_sleep',
  sleepStart: bne('2026-10-19', '00:02'), sleepEnd: bne('2026-10-19', '06:46'),
  durationHours: 6 + 4 / 60, awakHours: 40 / 60, efficiency: 90, onsetLatencySec: 600,
  deepSleepHours: 0.7, remSleepHours: 1.5, lightSleepHours: 3.87, averageHrvMs: 42,
})

/** The repository's `SleepSession` shape the score path reads. */
const asSession = (r: SleepRow) => ({
  ...r, sleepStart: new Date(r.sleepStart!), sleepEnd: new Date(r.sleepEnd!),
  timeInBedHours: null as number | null,
})

describe('#3057 — an Oura night is its long_sleep period', () => {
  it('only a typed, non-long_sleep period is secondary', () => {
    expect(isOuraSecondaryPeriod({ ouraSleepType: 'sleep' })).toBe(true)
    expect(isOuraSecondaryPeriod({ ouraSleepType: 'late_nap' })).toBe(true)
    expect(isOuraSecondaryPeriod({ ouraSleepType: 'rest' })).toBe(true)
    expect(isOuraSecondaryPeriod({ ouraSleepType: 'long_sleep' })).toBe(false)
    expect(isOuraSecondaryPeriod({ ouraSleepType: null })).toBe(false)
    expect(isOuraSecondaryPeriod({})).toBe(false)
  })

  // Both query orders: the card showed the fragment's 10% only when the fragment came back first.
  for (const [label, rows] of [['fragment first', [fragment, main]], ['main first', [main, fragment]]] as const) {
    it(`display (${label}): window, awake, efficiency and onset are the main period's`, () => {
      const out = mergeByDate([...rows])
      expect(out).toHaveLength(1)
      expect(out[0].sleepStart).toBe(main.sleepStart) // 00:02, not 23:05
      expect(out[0].sleepEnd).toBe(main.sleepEnd)
      expect(out[0].durationHours).toBe(main.durationHours)
      expect(out[0].awakHours).toBe(main.awakHours) // 40 m, not 58 m
      expect(out[0].efficiency).toBe(90) // not the fragment's 10
      expect(out[0].onsetLatencySec).toBe(600) // not the fragment's 0
      expect(out[0].remSleepHours).toBe(1.5)
    })
  }

  it('score: the fragment is a nap and the night is the long_sleep period alone', () => {
    const sessions = [fragment, main].map(asSession)
    const { nights, naps } = groupSleepPeriods(sessions, TZ)
    expect(naps.map(n => n.ouraId)).toEqual(['oura-fragment'])
    expect(nights).toHaveLength(1)
    expect(nights[0].windows.map(w => w.ouraId)).toEqual(['oura-main'])
    expect(nights[0].gapHours).toEqual([])

    const night = nightForDate(sessions, '2026-10-19', TZ)!
    expect(night.windows).toHaveLength(1)
    const [scored] = nightSessions(sessions, TZ)
    expect(scored.sleepStart.toISOString()).toBe(main.sleepStart)
    expect(scored.awakHours).toBe(main.awakHours)
    expect(scored.efficiency).toBe(90)
    expect(scored.onsetLatencySec).toBe(600)
  })

  it('two long_sleep periods on one night still group, in display and score', () => {
    const first = row({
      date: '2026-10-19', ouraId: 'oura-ls1', ouraSleepType: 'long_sleep',
      sleepStart: bne('2026-10-18', '22:00'), sleepEnd: bne('2026-10-19', '01:00'), durationHours: 2.8, efficiency: 93,
    })
    const second = row({
      date: '2026-10-19', ouraId: 'oura-ls2', ouraSleepType: 'long_sleep',
      sleepStart: bne('2026-10-19', '01:40'), sleepEnd: bne('2026-10-19', '06:40'), durationHours: 4.6, efficiency: 92,
    })
    const out = mergeByDate([first, second])
    expect(out).toHaveLength(1)
    expect(out[0].sleepStart).toBe(first.sleepStart)
    expect(out[0].durationHours).toBe(7.4)
    expect(out[0].efficiency).toBe(92) // the longer period's

    const { nights } = groupSleepPeriods([first, second].map(asSession), TZ)
    expect(nights).toHaveLength(1)
    expect(nights[0].windows).toHaveLength(2)
  })

  it('a ring split night with no Oura type still groups across a 105-minute gap', () => {
    // 2026-05-29 shape: 2.53 h + 4.02 h, one night, the gap that `sleep-night.ts` was built for.
    const a = row({
      date: '2026-10-19', ouraId: 'ble:100', sleepStart: bne('2026-10-18', '22:05'), sleepEnd: bne('2026-10-19', '00:38'),
      durationHours: 2.53, efficiency: 95, onsetLatencySec: 300,
    })
    const b = row({
      date: '2026-10-19', ouraId: 'ble:200', sleepStart: bne('2026-10-19', '02:23'), sleepEnd: bne('2026-10-19', '06:24'),
      durationHours: 4.02, efficiency: 88, onsetLatencySec: 900,
    })
    const { nights, naps } = groupSleepPeriods([a, b].map(asSession), TZ)
    expect(naps).toEqual([])
    expect(nights).toHaveLength(1)
    expect(nights[0].windows.map(w => w.ouraId)).toEqual(['ble:100', 'ble:200'])
    expect(nights[0].gapHours[0]).toBeCloseTo(105 / 60, 5)
  })

  it('display: a ring night split by a short wake still merges, with the main fragment\'s efficiency whatever the order', () => {
    const shortFirst = row({
      date: '2026-10-19', ouraId: 'ble:300', sleepStart: bne('2026-10-18', '22:30'), sleepEnd: bne('2026-10-18', '23:30'),
      durationHours: 0.9, awakHours: 0.1, efficiency: 70, onsetLatencySec: 120,
    })
    const longSecond = row({
      date: '2026-10-19', ouraId: 'ble:400', sleepStart: bne('2026-10-18', '23:50'), sleepEnd: bne('2026-10-19', '06:30'),
      durationHours: 6.1, awakHours: 0.5, efficiency: 91, onsetLatencySec: 480,
    })
    const out = mergeByDate([shortFirst, longSecond])
    expect(out).toHaveLength(1)
    expect(out[0].sleepStart).toBe(shortFirst.sleepStart) // the ring's grouping is unchanged
    expect(out[0].durationHours).toBe(7)
    expect(out[0].awakHours).toBe(0.6)
    expect(out[0].efficiency).toBe(91)
    expect(out[0].onsetLatencySec).toBe(480)
  })
})
