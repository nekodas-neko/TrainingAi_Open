// Direct-BLE Renpho scale — body-composition estimator.
//
// This is a GENERIC single-frequency BIA estimator (Deurenberg-style body-fat % combined with
// a bioimpedance-index correction, plus standard published physiological ratios for the
// remaining fields), NOT Renpho's own proprietary algorithm. Renpho's exact formula is
// unpublished and unreachable — see the plan's §0 "Mental model": our numbers will be close to,
// but not numerically identical to, what the Renpho app shows for the same weigh-in. That is
// expected, not a bug. Plan: docs/superpowers/plans/2026-07-27-renpho-ble-direct-scale.md

/** Weight delta from the user's last confirmed reading, above which a new weigh-in is staged
 *  as "pending" instead of auto-saved (owner's partner also uses this scale). */
export const SCALE_WEIGHT_ANOMALY_PCT = 0.15

/**
 * The band inside which a reading is confidently THIS user's, so it is claimed without asking.
 *
 * BF-58, option D (owner's choice, 2026-08-30): two phones hear one scale, and each app claims only
 * what falls in its own owner's band rather than linking accounts. This is the width that decision
 * needed, and the entry said to pick it "from the two real weights rather than a round number".
 *
 * **Both real weights were in the database and nobody had looked.** Measured 2026-09-14 over the
 * owner's 100 confirmed readings and the 6 he has tapped *Not me* on:
 *
 *   · his confirmed weight   **70.0 – 72.8 kg**  (whole history spans 5.2 kg)
 *   · his day-to-day change  **0.39 kg mean, 1.40 at p95, 2.85 worst**
 *   · the dismissed cluster  **57.5 – 58.0 kg**  — tight, and 12.0 kg below his lowest
 *
 * 8% of ~70 kg is ±5.6 kg: wider than his entire historical spread, so no genuine reading of his
 * falls outside it even after a long gap, and still **6.4 kg clear** of her cluster. The old 15%
 * (±10.5 kg) reached down to 59.5 and cleared her by only 1.5 kg, which is the thin margin BF-58
 * was written about.
 *
 * **This is identity by proxy and it degrades if the two weights converge** — which is why anything
 * between this band and `SCALE_WEIGHT_ANOMALY_PCT` still asks rather than guessing.
 */
export const SCALE_WEIGHT_CLAIM_PCT = 0.08

/** BIA requires bare-skin contact with both foot plates to complete the current path. Socks,
 *  stockings, or dry/calloused feet break that path and the scale reports impedance as 0 (no
 *  measurable value) rather than omitting the reading. Real bare-foot adult readings are on the
 *  order of 300-1200Ω (see REFERENCE_IMPEDANCE_INDEX below); anything under this floor is a
 *  no-contact reading, not a very-low body-fat one. Feeding 0 into the impedance-index formula
 *  divides by zero and floors bodyFatPct at its 3% clamp — a real incident (2026-07-28).*/
export const MIN_VALID_IMPEDANCE_OHMS = 200

export function hasValidImpedance(impedanceOhms: number): boolean {
  return impedanceOhms >= MIN_VALID_IMPEDANCE_OHMS
}

/** The profile fields the estimator needs the user to have actually entered. */
export interface CompositionProfile {
  heightCm?: number | null
  dateOfBirth?: string | Date | null
  sex?: string | null
}

/** Why a weigh-in stored no composition. `impedance` is a contact problem the user can fix by
 *  standing barefoot; `profile` is a gap in their own details. */
export type CompositionSkipReason = 'impedance' | 'profile'

/**
 * PS-33: the two ingest routes filled a missing height with 170 cm and a missing date of birth
 * with 35 years, then stored the resulting body fat and metabolic age under source `scale_ble`
 * as measured readings — live, 22 % body fat and a metabolic age of 37 on a profile with no date
 * of birth in it. A default is right for a display preference and wrong for an input to a
 * measurement: every field below moves the answer, and a reading nobody can tell apart from a
 * real one is worse than no reading at all.
 *
 * `sex` is here for the same reason even though the entry named only the other two — the
 * estimator reads `sex === 'male'`, so an absent value silently applies the female Deurenberg and
 * Mifflin-St Jeor terms rather than declining.
 *
 * Returns null when anything is missing; the caller stores weight only, which is a path both
 * routes already have for an invalid-impedance reading.
 */
export function resolveCompositionInputs(
  user: CompositionProfile | null | undefined,
  ageYears: number | null | undefined,
): Pick<ScaleCompositionInput, 'heightCm' | 'ageYears' | 'sex'> | null {
  const heightCm = user?.heightCm
  const sex = user?.sex
  if (heightCm == null || ageYears == null || !sex) return null
  return { heightCm, ageYears, sex }
}

export interface ScaleCompositionInput {
  weightKg: number
  /** Average of the packet's two impedance fields (ohms). */
  impedanceOhms: number
  heightCm: number
  ageYears: number
  sex: string | null | undefined
}

export interface ScaleComposition {
  bodyFatPct: number
  skeletalMusclePct: number
  fatFreeMassKg: number
  subcutaneousFatPct: number
  visceralFatIndex: number
  bodyWaterPct: number
  muscleMassKg: number
  boneMassKg: number
  proteinPct: number
  bmrKcal: number
  metabolicAge: number
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** Height²/impedance is the standard BIA predictor variable used across the literature.
 *  ~170cm / ~500Ω (a typical adult reading) gives an index of ~57.8, used below as the
 *  zero-point for the impedance correction term. */
const REFERENCE_IMPEDANCE_INDEX = (170 * 170) / 500

export function computeBodyComposition(input: ScaleCompositionInput): ScaleComposition {
  const { weightKg, impedanceOhms, heightCm, ageYears, sex } = input
  const isMale = sex === 'male'
  const heightM = heightCm / 100
  const bmi = weightKg / (heightM * heightM)

  const impedanceIndex = (heightCm * heightCm) / impedanceOhms
  const impedanceCorrection = (REFERENCE_IMPEDANCE_INDEX - impedanceIndex) * 0.05

  // Deurenberg et al. 1991 body-fat-% formula (BMI + age + sex), widely published — plus the
  // impedance correction above so the captured bioimpedance data (not just BMI) shapes the
  // estimate.
  const bodyFatPct = clamp(
    1.2 * bmi + 0.23 * ageYears - 10.8 * (isMale ? 1 : 0) - 5.4 + impedanceCorrection,
    3, 60,
  )

  const fatMassKg = weightKg * (bodyFatPct / 100)
  const fatFreeMassKg = weightKg - fatMassKg

  // Standard published physiological ratios applied to fat-free mass (FFM) — generic
  // estimates used in the absence of a vendor-specific regression formula.
  const bodyWaterKg = fatFreeMassKg * 0.73 // Pace & Rathbun hydration constant: ~73% of FFM is water
  const bodyWaterPct = clamp((bodyWaterKg / weightKg) * 100, 35, 75)
  const skeletalMuscleKg = fatFreeMassKg * 0.53 // Janssen et al. 2000: ~53% of FFM is skeletal muscle
  const skeletalMusclePct = clamp((skeletalMuscleKg / weightKg) * 100, 10, 60)
  const muscleMassKg = fatFreeMassKg * 0.75 // broader "muscle mass" category (incl. organs/skin) vs skeletal muscle alone
  const boneMassKg = clamp(weightKg * (isMale ? 0.045 : 0.04), 1.5, 5)
  const proteinPct = clamp(((fatFreeMassKg - bodyWaterKg - boneMassKg) / weightKg) * 100, 5, 25)
  const subcutaneousFatPct = clamp(bodyFatPct * 0.85, 2, 55) // subcutaneous is the bulk of total fat; visceral is the remainder

  // Visceral fat index and metabolic age are directional/approximate only — see the plan's
  // Risks section ("metabolic age is the lowest-value field").
  const visceralFatIndex = clamp(Math.round((bmi - 18.5) * 0.9 + ageYears * 0.05), 1, 30)

  // Mifflin-St Jeor (1990) — the most validated resting-metabolic-rate equation in clinical
  // use, independent of impedance.
  const sexTerm = isMale ? 5 : -161
  const bmrKcal = Math.round(10 * weightKg + 6.25 * heightCm - 5 * ageYears + sexTerm)

  // Metabolic age: the age at which a "healthy" body-fat-% (age/sex-adjusted reference) would
  // match this person's actual body-fat-%. Rough/directional only.
  const expectedBodyFatPctForAge = (isMale ? 12 : 20) + ageYears * 0.2
  const metabolicAge = clamp(Math.round(ageYears + (bodyFatPct - expectedBodyFatPctForAge) * 0.8), 15, 80)

  return {
    bodyFatPct: Math.round(bodyFatPct * 10) / 10,
    skeletalMusclePct: Math.round(skeletalMusclePct * 10) / 10,
    fatFreeMassKg: Math.round(fatFreeMassKg * 100) / 100,
    subcutaneousFatPct: Math.round(subcutaneousFatPct * 10) / 10,
    visceralFatIndex,
    bodyWaterPct: Math.round(bodyWaterPct * 10) / 10,
    muscleMassKg: Math.round(muscleMassKg * 100) / 100,
    boneMassKg: Math.round(boneMassKg * 100) / 100,
    proteinPct: Math.round(proteinPct * 10) / 10,
    bmrKcal,
    metabolicAge,
  }
}

// ── Re-deriving a stored reading at a different profile (RV-165) ─────────────
//
// **Composition is computed ONCE, at ingest, from the profile of that moment — so correcting the
// profile afterwards does not reach the stored rows.** The owner corrected their height from 160 to
// 158 to match a DEXA printout, and every reading before that is still a 160 cm number. That would
// be a history question and nothing more, except that the DEXA calibration offset is fitted live
// against those stored values (`body-fat-calibration.ts`), so one stale pair biases every corrected
// body-fat reading the app shows today.
//
// **Nothing extra needs storing to undo it, which is the useful part.** Two properties of the
// formula above make the original inputs recoverable from columns already written:
//
//  1. `bmrKcal` is Mifflin-St Jeor — `10w + 6.25h − 5a + sexTerm` — with **no impedance term** and
//     linear in height. So the height used at ingest falls straight out of the stored BMR.
//  2. Impedance enters the whole model through **`bodyFatPct` alone**; every other output is a
//     function of body fat, weight, height, age and sex. So once the height is known, the
//     impedance index follows from the stored body-fat value.
//
// Verified against production on 2026-09-24: 08-27 and 09-01 carry the SAME weight (71.7 kg) and
// BMRs of 1557 and 1545. The 12 kcal gap is 12/6.25 = 1.92 cm, and solving each gives exactly
// h = 160 and h = 158 at age 33 — the documented correction, recovered from the table alone.

/** Rounded BMR loses ±0.5 kcal, which is ±0.08 cm of height — far inside the tolerance below. */
const HEIGHT_RECOVERY_TOLERANCE_CM = 0.25

/** Outside this, the "height" is not a height and the reconstruction is refused rather than used. */
const PLAUSIBLE_HEIGHT_CM: readonly [number, number] = [120, 230]

/** The file's own documented band for an adult reading; a recovery outside it is not trustworthy. */
const PLAUSIBLE_IMPEDANCE_OHMS: readonly [number, number] = [200, 1500]

/**
 * The height that produced a stored `bmr_kcal`, or null when it cannot be recovered.
 *
 * `bmrKcal` is the only stored output with no impedance term, which is what makes this solvable.
 */
export function heightUsedForStoredBmr(
  bmrKcal: number | null | undefined,
  weightKg: number,
  ageYears: number,
  sex: string | null | undefined,
): number | null {
  if (bmrKcal == null || !Number.isFinite(bmrKcal)) return null
  const sexTerm = sex === 'male' ? 5 : -161
  const heightCm = (bmrKcal - 10 * weightKg + 5 * ageYears - sexTerm) / 6.25
  if (!Number.isFinite(heightCm)) return null
  return heightCm >= PLAUSIBLE_HEIGHT_CM[0] && heightCm <= PLAUSIBLE_HEIGHT_CM[1] ? heightCm : null
}

/**
 * What a stored scale reading would have said at `heightCm`, or null when it cannot be re-derived.
 *
 * Returns the stored value unchanged when the height it was computed at already matches — "no
 * correction needed" and "could not correct" are different answers, and a caller that cannot tell
 * them apart would silently drop readings.
 *
 * The forward half deliberately calls `computeBodyComposition` rather than re-implementing the
 * formula: only the INVERSE lives here, so the two cannot drift.
 */
export function recomputeStoredBodyFatPctAtHeight(args: {
  storedBodyFatPct: number
  storedBmrKcal: number | null | undefined
  weightKg: number
  ageYears: number
  sex: string | null | undefined
  heightCm: number
}): number | null {
  const { storedBodyFatPct, storedBmrKcal, weightKg, ageYears, sex, heightCm } = args
  if (!Number.isFinite(storedBodyFatPct) || !Number.isFinite(weightKg) || weightKg <= 0) return null

  // A stored value sitting on `computeBodyComposition`'s clamp carries no information about what
  // the formula actually produced, so it cannot be inverted — refuse rather than invent one.
  if (storedBodyFatPct <= 3 || storedBodyFatPct >= 60) return null

  const originalHeightCm = heightUsedForStoredBmr(storedBmrKcal, weightKg, ageYears, sex)
  if (originalHeightCm == null) return null
  if (Math.abs(originalHeightCm - heightCm) < HEIGHT_RECOVERY_TOLERANCE_CM) return storedBodyFatPct

  // Invert the body-fat line for the impedance term, then the index for the impedance itself.
  const originalHeightM = originalHeightCm / 100
  const originalBmi = weightKg / (originalHeightM * originalHeightM)
  const isMale = sex === 'male'
  const withoutImpedance = 1.2 * originalBmi + 0.23 * ageYears - 10.8 * (isMale ? 1 : 0) - 5.4
  const impedanceIndex = REFERENCE_IMPEDANCE_INDEX - (storedBodyFatPct - withoutImpedance) / 0.05
  if (!Number.isFinite(impedanceIndex) || impedanceIndex <= 0) return null

  const impedanceOhms = (originalHeightCm * originalHeightCm) / impedanceIndex
  if (impedanceOhms < PLAUSIBLE_IMPEDANCE_OHMS[0] || impedanceOhms > PLAUSIBLE_IMPEDANCE_OHMS[1]) return null

  return computeBodyComposition({ weightKg, impedanceOhms, heightCm, ageYears, sex }).bodyFatPct
}
