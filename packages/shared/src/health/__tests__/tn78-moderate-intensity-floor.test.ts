import { describe, it, expect } from 'vitest'
import { computeHrZones, moderateIntensityBpm, MODERATE_INTENSITY_FRAC } from '../hr-zones'
import { activeMinutesFromReadings } from '../zone-minutes'
import { targetsForRunType } from '@trainingai/shared/running/hr-targets'
import type { FitnessSnapshot } from '@trainingai/shared/running/types'

/**
 * TN-78 — the zone-minutes goal is WHO's MODERATE target, and it was scored at a threshold where
 * ACSM puts VIGOROUS. Owner's decision, 2026-09-27: moderate starts at 40% of heart-rate reserve.
 *
 * **The obvious implementation is wrong and CI caught it.** Moving the Light band's floor to 0.4
 * fixes the accounting and silently moves run prescriptions with it, because
 * `targetsForRunType` builds from the same map — a recovery run's ceiling would fall from 134 bpm
 * to 106. So the moderate floor is its own constant, and the zone map is untouched. These tests
 * pin both halves of that.
 */

// maxHr 190, restingHr 50 → reserve 140. Light floor 50+0.6*140 = 134; moderate 50+0.4*140 = 106.
const profile = { maxHr: 190, restingHr: 50 }
const zones = computeHrZones(profile)
const t = (min: number) => new Date(Date.UTC(2026, 8, 27, 1, 0, 0) + min * 60_000).getTime()

describe('the moderate-intensity floor (TN-78)', () => {
  it('is 40% of reserve, and separate from the zone map', () => {
    expect(MODERATE_INTENSITY_FRAC).toBe(0.4)
    expect(moderateIntensityBpm(profile)).toBe(106)
  })

  it('LEAVES the zone map alone — this is the half that broke first', () => {
    // The Light band must still start at 60%. If this ever reads 106, run prescriptions moved
    // too and a recovery run's ceiling went with them.
    expect(zones[1].minBpm).toBe(134)
    expect(zones[2].minBpm).toBe(148)
  })

  it('does not move a recovery run\'s ceiling', () => {
    // The concrete regression: `recovery` caps at zone 1, so its ceiling is the Light floor.
    const fit: FitnessSnapshot = {
      maxHr: 190, restingHr: 50, vo2max: 50, thresholdHr: null,
      weeklyBaseMinutes: 90, source: 'baseline',
    }
    expect(targetsForRunType('recovery', fit).hrHighBpm).toBe(134)
  })

  it('counts a brisk walk the old threshold ignored entirely', () => {
    // 120 bpm sits between the moderate floor (106) and the Light floor (134): the exact effort
    // the WHO goal is about, and worth nothing before.
    const walk = [{ timestamp: t(0), bpm: 120 }, { timestamp: t(10), bpm: 120 }]
    expect(activeMinutesFromReadings(walk, zones, moderateIntensityBpm(profile), 600)).toBe(10)
  })

  it('credits moderate once and vigorous double', () => {
    const run = [{ timestamp: t(0), bpm: 150 }, { timestamp: t(10), bpm: 150 }]
    expect(activeMinutesFromReadings(run, zones, moderateIntensityBpm(profile), 600)).toBe(20)
  })

  it('is inclusive at the floor and excludes the bpm below it', () => {
    const at = [{ timestamp: t(0), bpm: 106 }, { timestamp: t(1), bpm: 106 }]
    expect(activeMinutesFromReadings(at, zones, 106)).toBe(1)
    const below = [{ timestamp: t(0), bpm: 105 }, { timestamp: t(1), bpm: 105 }]
    expect(activeMinutesFromReadings(below, zones, 106)).toBe(0)
  })

  it('caps a data gap like the zone accumulator does', () => {
    const sparse = [{ timestamp: t(0), bpm: 120 }, { timestamp: t(60), bpm: 120 }]
    expect(activeMinutesFromReadings(sparse, zones, 106)).toBe(2) // 120s cap
  })
})
