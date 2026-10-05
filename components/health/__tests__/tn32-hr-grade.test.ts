import { describe, it, expect } from 'vitest'
import { gradeHeartRate } from '../hr-grade'
import { computeHrZones, HR_ZONE_META } from '@trainingai/shared/health/hr-zones'

// The owner's own numbers: resting 52, max 185 → reserve 133, so Zone 1 runs to 52 + 0.6×133 ≈ 132.
const PROFILE = { maxHr: 185, restingHr: 52 }

describe('TN-32 — the page must not alarm at a rate inside the user’s own Zone 1', () => {
  it('⛔ grades 60–100 bpm as Recovery, where the old fixed cuts painted it red', () => {
    // `<100 → "Normal"` at `#f87171` was the defect: a red the zone palette uses for nothing in
    // that range, over most of a sitting day.
    const recovery = HR_ZONE_META.find(z => z.id === 1)!
    for (const bpm of [60, 75, 99, 131]) {
      expect(gradeHeartRate(bpm, PROFILE), `at ${bpm} bpm`).toEqual({ label: 'Recovery', color: recovery.color })
    }
    expect(recovery.color).not.toBe('#f87171')
  })

  it('is the entry’s pass test: nothing inside Zone 1 carries the Peak colour', () => {
    const zones = computeHrZones(PROFILE)
    const peak = HR_ZONE_META.find(z => z.id === 5)!
    for (let bpm = Math.ceil(zones[0].minBpm); bpm < zones[0].maxBpm; bpm++) {
      expect(gradeHeartRate(bpm, PROFILE)!.color, `at ${bpm} bpm`).not.toBe(peak.color)
    }
  })

  it('calls a true resting rate Resting, not Recovery', () => {
    // HR_REST_THRESHOLD is 0.05 of a 133 reserve ≈ 6.7 bpm above rest, the same boundary Body
    // Battery and the activity score use.
    expect(gradeHeartRate(52, PROFILE)!.label).toBe('Resting')
    expect(gradeHeartRate(58, PROFILE)!.label).toBe('Resting')
    expect(gradeHeartRate(60, PROFILE)!.label).toBe('Recovery')
  })

  it('still grades the genuinely high rates, from the user’s own bands', () => {
    const zones = computeHrZones(PROFILE)
    expect(gradeHeartRate(zones[4].minBpm + 1, PROFILE)!.label).toBe('Peak')
    expect(gradeHeartRate(zones[3].minBpm + 1, PROFILE)!.label).toBe('Hard')
    expect(gradeHeartRate(250, PROFILE)!.label).toBe('Peak')
  })

  it('takes every colour from the zone palette, never a literal of its own', () => {
    const palette = new Set(HR_ZONE_META.map(z => z.color))
    for (const bpm of [52, 70, 120, 140, 160, 180]) {
      expect(palette.has(gradeHeartRate(bpm, PROFILE)!.color), `at ${bpm} bpm`).toBe(true)
    }
  })

  it('⛔ returns NO grade without a profile, rather than inventing cuts', () => {
    // The whole point of the entry: this was the only place a heart rate was graded without the
    // user's own resting and max. Absent a profile the honest answer is no label.
    expect(gradeHeartRate(70, null)).toBeNull()
    expect(gradeHeartRate(70, undefined)).toBeNull()
    expect(gradeHeartRate(70, { maxHr: Number.NaN, restingHr: 52 })).toBeNull()
    // A profile that cannot describe a reserve is not a profile.
    expect(gradeHeartRate(70, { maxHr: 50, restingHr: 52 })).toBeNull()
  })

  it('returns no grade when there is no reading', () => {
    expect(gradeHeartRate(null, PROFILE)).toBeNull()
    expect(gradeHeartRate(undefined, PROFILE)).toBeNull()
  })
})
