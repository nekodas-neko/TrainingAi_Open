// #2264 — `/api/sleep-sessions` dropped `manualSleepStart`, so the bedtime a user entered was
// invisible wherever the card reads that route rather than the local store. The route now returns it,
// and `mergeByDate` has to carry it through every way it combines a date's rows, because the field is
// not one of the columns it merges: it survives only by riding on whichever row the merge keeps.
import { describe, it, expect } from 'vitest'
import { mergeByDate, localSleepRowsAsNights, type SleepRow } from '@/lib/sleep/merge-sessions'
import type { LocalSleepSession } from '@/lib/local-store/types'

const BEDTIME = '2026-10-05T13:15:00.000Z'

const row = (over: Partial<SleepRow>): SleepRow => ({
  date: '2026-10-06', ouraId: null,
  durationHours: 7, deepSleepHours: 1, remSleepHours: 1.5, lightSleepHours: 4.5, awakHours: 0.5,
  efficiency: 90, onsetLatencySec: 600, averageHrvMs: 50, avgHeartRate: 55, lowestHeartRate: 48,
  restlessPeriods: 3, sleepScore: 80, respiratoryRate: 14, sleepPhase5Min: null,
  sleepStart: '2026-10-05T14:00:00.000Z', sleepEnd: '2026-10-05T21:00:00.000Z',
  sleepTimeRecommendation: null, manualSleepStart: BEDTIME,
  ...over,
})

describe('manualSleepStart survives mergeByDate (#2264)', () => {
  it('a single row keeps it', () => {
    expect(mergeByDate([row({})])[0].manualSleepStart).toBe(BEDTIME)
  })

  it('a null stays null, not undefined and not a default', () => {
    expect(mergeByDate([row({ manualSleepStart: null })])[0].manualSleepStart).toBeNull()
  })

  it('an Oura row merged with a Samsung row keeps it, and the measured window is not widened by it', () => {
    const out = mergeByDate([
      row({ ouraId: 'oura-1' }),
      row({ ouraId: null, sleepStart: '2026-10-05T13:50:00.000Z', manualSleepStart: BEDTIME }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].manualSleepStart).toBe(BEDTIME)
    // The Samsung row's earlier start extends the display window as it always did; the remembered
    // bedtime is a separate field and moves nothing.
    expect(out[0].sleepStart).toBe('2026-10-05T13:50:00.000Z')
  })

  it('two contiguous same-source splits keep it, with the durations still added', () => {
    const out = mergeByDate([
      row({ ouraId: 'a', durationHours: 3, sleepStart: '2026-10-05T14:00:00.000Z', sleepEnd: '2026-10-05T17:00:00.000Z' }),
      row({ ouraId: 'b', durationHours: 4, sleepStart: '2026-10-05T17:00:00.000Z', sleepEnd: '2026-10-05T21:00:00.000Z' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].manualSleepStart).toBe(BEDTIME)
    expect(out[0].durationHours).toBe(7)
  })
})

describe('the local-store seed has the same shape as the route (#2264)', () => {
  const local = (over: Partial<LocalSleepSession>): LocalSleepSession => ({
    id: 'l1', date: '2026-10-06', durationHours: 7, deepSleepHours: 1, remSleepHours: 1.5, lightSleepHours: 4.5,
    sleepStart: '2026-10-05T14:00:00.000Z', sleepEnd: '2026-10-05T21:00:00.000Z', awakHours: 0.5,
    ouraId: 'o1', efficiency: 90, onsetLatencySec: 600, averageHrvMs: 50, avgHeartRate: 55, lowestHeartRate: 48,
    restlessPeriods: 3, sleepScore: 80, respiratoryRate: 14, sleepPhase5Min: null, timeInBedHours: 7.5,
    manualSleepStart: BEDTIME, manualEntry: false, syncStatus: 'synced', updatedAt: '2026-10-06T00:00:00.000Z',
    ...over,
  })

  it('carries the bedtime from the local row, so a cold open and the network reply agree', () => {
    expect(localSleepRowsAsNights([local({})])[0].manualSleepStart).toBe(BEDTIME)
    expect(localSleepRowsAsNights([local({ manualSleepStart: null })])[0].manualSleepStart).toBeNull()
  })
})
