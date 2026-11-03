// #3582 — the measured-overview bedtime average uses when sleep really began (an Oura Cloud night's
// hypnogram onset) and falls back to the bed window for a night without one.
import { describe, it, expect } from 'vitest'
import { sleepAverages, circularMeanMinutes, type SleepNight } from '@trainingai/shared/profile/measured-overview'

const night = (date: string, o: Partial<SleepNight> = {}): SleepNight => ({
  date, durationHours: 7, efficiency: 85, sleepStart: `${date}T13:00:00.000Z`,
  lowestHeartRate: 48, respiratoryRate: 14, ...o,
})

describe('sleepAverages bedtime (#3582)', () => {
  it('without onsetAt it averages the bed window, exactly as before', () => {
    const nights = [night('2026-10-20'), night('2026-10-21')]
    expect(sleepAverages(nights)!.bedtimeMinutes).toBe(circularMeanMinutes(nights.map(n => n.sleepStart)))
  })

  it('with onsetAt it averages when sleep began, 40 minutes after the bed window opened', () => {
    const without = sleepAverages([night('2026-10-20')])!.bedtimeMinutes!
    const withOnset = sleepAverages([night('2026-10-20', { onsetAt: '2026-10-20T13:40:00.000Z' })])!.bedtimeMinutes!
    expect(((withOnset - without) + 1440) % 1440).toBeCloseTo(40, 5)
  })

  it('mixes a night with onset and a ring night without one: each contributes its own best time', () => {
    const nights = [night('2026-10-20', { onsetAt: '2026-10-20T13:40:00.000Z' }), night('2026-10-21')]
    expect(sleepAverages(nights)!.bedtimeMinutes).toBe(circularMeanMinutes(['2026-10-20T13:40:00.000Z', '2026-10-21T13:00:00.000Z']))
  })

  it('a null onsetAt falls back to the bed window; a partial night is still left out', () => {
    expect(sleepAverages([night('2026-10-20', { onsetAt: null })])!.bedtimeMinutes)
      .toBe(circularMeanMinutes(['2026-10-20T13:00:00.000Z']))
    expect(sleepAverages([night('2026-10-20', { onsetAt: '2026-10-20T14:00:00.000Z', partialNightAt: '2026-10-21T00:00:00.000Z' })])!.bedtimeMinutes).toBeNull()
  })
})
