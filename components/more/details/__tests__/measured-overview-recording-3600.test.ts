// #3600 — the measured-overview averages count a night its source recorded incompletely as partial,
// through the shared `isPartialNight`, exactly as the owner's mark does. A night without the flag is as before.
import { describe, it, expect } from 'vitest'
import { sleepAverages, circularMeanMinutes, type SleepNight } from '@trainingai/shared/profile/measured-overview'
import { isPartialNight } from '@trainingai/shared/health/partial-night'

const night = (date: string, durationHours: number, o: Partial<SleepNight> = {}): SleepNight => ({
  date, durationHours, efficiency: 85, sleepStart: `${date}T13:00:00.000Z`,
  lowestHeartRate: 48, respiratoryRate: 14, ...o,
})

describe('partial-night check (#3600)', () => {
  it('an incomplete recording is partial; the owner\'s mark still is; a complete night is not', () => {
    expect(isPartialNight({ recordingIncomplete: true })).toBe(true)
    expect(isPartialNight({ partialNightAt: '2026-10-21T00:00:00.000Z' })).toBe(true)
    expect(isPartialNight({ recordingIncomplete: false })).toBe(false)
    expect(isPartialNight({ recordingIncomplete: null, partialNightAt: null })).toBe(false)
    expect(isPartialNight({})).toBe(false)
  })

  it('a low-battery night keeps its physiology in the averages and loses its hours, efficiency and bedtime', () => {
    const full = night('2026-10-20', 8)
    const low = night('2026-10-21', 3, { recordingIncomplete: true, lowestHeartRate: 40, sleepStart: '2026-10-21T18:00:00.000Z' })
    const a = sleepAverages([full, low])!
    expect(a.nights).toBe(2)
    expect(a.durationHours).toBe(8)
    expect(a.bedtimeMinutes).toBe(circularMeanMinutes([full.sleepStart]))
    expect(a.lowestHeartRate).toBe(44)
  })

  it('a night without the field averages exactly as before', () => {
    const nights = [night('2026-10-20', 8), night('2026-10-21', 6)]
    expect(sleepAverages(nights)!.durationHours).toBe(7)
  })
})
