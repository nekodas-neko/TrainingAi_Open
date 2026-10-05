import {
  computeHrZones, hrReserve, zoneForBpm, HR_REST_THRESHOLD,
} from '@trainingai/shared/health/hr-zones'

/**
 * TN-32 — grade a heart rate against the USER's own zones, not fixed cuts.
 *
 * The Heart Rate page graded with `<60 Resting / <100 Normal / else Elevated` and painted the
 * 60–100 band `#f87171`, a red the zone palette uses for nothing in that range. For this owner that
 * is an alarm colour over most of a normal day: with a resting HR of 52 and a max of 185, Zone 1
 * runs to 132 bpm, so every reading from 60 to 132 was red while sitting inside his own Recovery
 * band.
 *
 * Two rules come out of that, and both are the point of the fix:
 * - **The bands are the user's.** `computeHrZones` is the one place they are built (Karvonen off
 *   the reserve), and the colours come from the zone itself — never a second palette.
 * - **Without a profile there is no grade.** Returning `null` is the honest answer; inventing cuts
 *   is what this entry exists to remove.
 */

export interface HrProfileInput {
  maxHr: number
  restingHr: number
}

export interface HrGrade {
  label: string
  color: string
}

export function gradeHeartRate(bpm: number | null | undefined, profile: HrProfileInput | null | undefined): HrGrade | null {
  if (bpm == null || !Number.isFinite(bpm)) return null
  if (!profile || !Number.isFinite(profile.maxHr) || !Number.isFinite(profile.restingHr)) return null
  if (profile.maxHr <= profile.restingHr) return null

  const zones = computeHrZones(profile)

  // At rest is its own reading, and it is the same boundary Body Battery and the activity score
  // use — `HR_REST_THRESHOLD` of the reserve above resting. Zone 1 spans from rest to 60% of
  // reserve, so without this everything from a true resting rate upward reads as "Recovery".
  const restCeiling = profile.restingHr + HR_REST_THRESHOLD * hrReserve(profile.maxHr, profile.restingHr)
  if (bpm <= restCeiling) return { label: 'Resting', color: zones[0].color }

  const zone = zoneForBpm(bpm, zones)
  return { label: zone.name, color: zone.color }
}
