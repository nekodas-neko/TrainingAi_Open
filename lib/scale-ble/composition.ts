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
