import { describe, it, expect } from 'vitest'
import {
  computeHrZones, moderateIntensityBpm, vigorousIntensityBpm, whoMinuteWeightForZone,
  MODERATE_INTENSITY_FRAC, VIGOROUS_INTENSITY_FRAC,
} from '../hr-zones'
import { activeMinutesFromReadings, activeMinutesFromZoneSeconds } from '../zone-minutes'
import { weeklyZoneTargets } from '../../running/zone-targets'

/**
 * #2198 (owner, 2026-10-05): one vigorous line, 60% of heart-rate reserve (ACSM), read by every WHO
 * roll-up. Before it, the Activity score's zone minutes doubled from Zone 3 (70%) and the run plan's
 * "meets 150 min" from Zone 4 (80%), and neither was ACSM's line. The zone bands do not move.
 */

// maxHr 190, restingHr 50 → reserve 140. Moderate 106, vigorous 134, Zone 3 floor 148, Zone 4 162.
const profile = { maxHr: 190, restingHr: 50 }
const floors = { moderateFloorBpm: moderateIntensityBpm(profile), vigorousFloorBpm: vigorousIntensityBpm(profile) }
const t = (min: number) => new Date(Date.UTC(2026, 9, 5, 2, 0, 0) + min * 60_000).getTime()
const steady = (bpm: number, minutes: number) => [{ timestamp: t(0), bpm }, { timestamp: t(minutes), bpm }]

describe('the vigorous-intensity line (#2198)', () => {
  it('is 60% of reserve, beside the 40% moderate floor', () => {
    expect(VIGOROUS_INTENSITY_FRAC).toBe(0.6)
    expect(MODERATE_INTENSITY_FRAC).toBe(0.4)
    expect(vigorousIntensityBpm(profile)).toBe(134)
  })

  it('leaves the zone bands where they were', () => {
    expect(computeHrZones(profile).map(z => z.minBpm)).toEqual([50, 134, 148, 162, 176])
  })

  it('counts an effort between 60% and 70% of reserve double in the readings roll-up', () => {
    // 140 bpm: above the vigorous line (134), below the Zone 3 floor (148). This band is the whole
    // change: it counted once before.
    expect(activeMinutesFromReadings(steady(140, 10), floors, 600)).toBe(20)
    // Just under the line it is moderate, once.
    expect(activeMinutesFromReadings(steady(133, 10), floors, 600)).toBe(10)
    // Inclusive at the line.
    expect(activeMinutesFromReadings(steady(134, 10), floors, 600)).toBe(20)
  })

  it('reads the vigorous edge it is given, not a zone edge', () => {
    // With the line moved above the effort, the same readings count once: the function does not
    // fall back to Zone 3 or any other band.
    expect(activeMinutesFromReadings(steady(140, 10), { ...floors, vigorousFloorBpm: 150 }, 600)).toBe(10)
  })

  it('weights zones the same way in every per-zone roll-up', () => {
    expect([1, 2, 3, 4, 5].map(id => whoMinuteWeightForZone(id as 1))).toEqual([0, 2, 2, 2, 2])
    expect(activeMinutesFromZoneSeconds([600, 600, 0, 0, 0])).toBe(20)
  })

  it('the run plan counts Zone 2 and 3 double too, so its "meets 150 min" agrees with the score', () => {
    // zone2-base at the 150-min floor: [30, 108, 8, 5, 0]. Old tally 108 + 8 + 2×5 = 126 (short);
    // with every zone from 2 up doubled, 2 × (108 + 8 + 5) = 242.
    const plan = weeklyZoneTargets('zone2-base', 150)
    expect(plan.perZone.map(z => z.minutes)).toEqual([30, 108, 8, 5, 0])
    expect(plan.moderateEquivMinutes).toBe(242)
    expect(plan.meetsActivityGuideline).toBe(true)
  })
})
