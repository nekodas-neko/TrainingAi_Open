// The body-fat calibration, built from rows already read (moved out of the Postgres adapter for
// #2690, so a replay script can build the same calibration from production rows without a second
// copy of the restating rule). Pure: no I/O.

import { ageFromDob } from '@trainingai/shared/date-utils'
import {
  deriveBodyFatCalibration, pairScansWithReadings, type BodyFatCalibration,
} from '@trainingai/shared/health/body-fat-calibration'
import { recomputeStoredBodyFatPctAtHeight } from '@/lib/scale-ble/composition'

export interface CalibrationReading {
  date: string
  bodyFatPct: number
  /** `source_map.body_fat_pct`. */
  source: string | null
  weightKg: number | null
  bmrKcal: number | null
}

export function buildBodyFatCalibration(input: {
  scans: { scannedOn: string; pctFat: number }[]
  readings: CalibrationReading[]
  profile: { heightCm: number | null; dateOfBirth: string | null; sex: string | null } | null
  source: string
}): BodyFatCalibration | null {
  const { profile } = input
  // RV-165. **Composition is computed once, at ingest, from the profile of that moment — so the
  // stored value is only comparable to a DEXA scan if the profile has not moved since.** The
  // owner's height was corrected from 160 to 158 to match a DEXA printout, and the 08-27 pair
  // that sets the whole offset is still a 160 cm number. Fitted against it the offset came out
  // +3.2 where the corrected reading gives +2.3, so every body-fat value the app has shown since
  // has been about a point high.
  //
  // Re-deriving needs nothing that is not already stored: `bmr_kcal` has no impedance term and is
  // linear in height, so it gives back the height used; impedance then follows from the stored
  // body-fat value.
  //
  // **A reading that cannot be re-derived is KEPT AS STORED, not dropped.** Without a BMR there is
  // no evidence the reading is stale — only an inability to check — and dropping it throws away a
  // pair over a question that was never answered. Keeping it is exactly today's behaviour, so this
  // can substitute a better value but never produce a worse calibration than the one it replaces.
  // Dropping was tried first and collapsed the calibration to null for every reading without a
  // stored BMR, which `body-fat-correction-consumers` caught.
  const restated = input.readings.map(r => {
    const stored = r.bodyFatPct
    // Without a profile there is nothing to restate to; the readings stand as stored, which is
    // exactly today's behaviour.
    if (profile?.heightCm == null || !profile.sex) return r
    // Age AT THE READING, not today — a birthday between the weigh-in and now would otherwise
    // shift the recovered height by 5/6.25 = 0.8 cm and quietly poison the inversion.
    const ageYears = ageFromDob(profile.dateOfBirth ?? null, new Date(`${r.date}T12:00:00Z`))
    if (ageYears == null) return r
    const atCurrent = recomputeStoredBodyFatPctAtHeight({
      storedBodyFatPct: stored,
      storedBmrKcal: r.bmrKcal,
      weightKg: r.weightKg as number,
      ageYears,
      sex: profile.sex,
      heightCm: profile.heightCm,
    })
    return { ...r, bodyFatPct: atCurrent ?? stored }
  })

  const pairs = pairScansWithReadings(
    input.scans,
    restated.map(r => ({ date: r.date, bodyFatPct: r.bodyFatPct, source: r.source })),
    input.source,
  )
  return deriveBodyFatCalibration(pairs, input.source)
}
