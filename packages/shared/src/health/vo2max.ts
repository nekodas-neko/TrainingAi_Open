import { hrMaxFromAge } from './hr-zones'
import type { ActivityLevel } from '@trainingai/shared/types/user'

// VO₂max derivation — One Formula, One Place. Every VO₂max estimate in the app comes
// from here. Uth–Sørensen (Uth et al. 2004) is the primary ring-friendly estimate;
// Jackson non-exercise (Jackson et al. 1990, BMI form) is the cross-check / fallback
// when resting HR is missing. Output clamped to the OTS validator's [10,100] range —
// OTS only ever buckets VO₂max into a low/fair/high/peak band, so landing in the right
// band matters far more than absolute precision.

/** Physical-Activity Rating (0–7) per self-reported activity level — the Jackson NEX
 *  PA-R term. These are THIS module's calibration constants (One Formula, One Place). */
export const PA_R_BY_ACTIVITY: Record<ActivityLevel, number> = {
  sedentary: 0, light: 2, moderate: 4, active: 5, extra_active: 7,
}

export interface Vo2MaxInputs {
  restingHr: number | null
  measuredMaxHr: number | null   // from activity_logs.max_hr (preferred over age-predicted)
  age: number | null
  sex: string | null            // 'male' | 'female' | 'other' | null
  weightKg: number | null
  heightCm: number | null
  activityLevel: ActivityLevel | null
}

export interface Vo2MaxResult {
  value: number | null           // ml/kg/min, clamped [10,100], or null if underivable
  method: 'uth-sorensen' | 'jackson-nex' | null
  crosscheck: number | null      // the OTHER model's value when both computable (for provenance/UI)
}

const clamp = (v: number) => Math.max(10, Math.min(100, v))

/** Jackson et al. (1990) non-exercise model (BMI form). sex: male=1 else 0. */
export function jacksonNonExercise(
  { age, sex, bmi, activityLevel }: { age: number; sex: string | null; bmi: number; activityLevel: ActivityLevel },
): number {
  const paR = PA_R_BY_ACTIVITY[activityLevel]
  const sexMale = sex === 'male' ? 1 : 0
  return 56.363 + 1.921 * paR - 0.381 * age - 0.754 * bmi + 10.987 * sexMale
}

export function deriveVo2Max(i: Vo2MaxInputs): Vo2MaxResult {
  // Uth–Sørensen: VO2max ≈ 15.3 × HRmax / HRrest. Prefer a measured max; else 220 − age.
  let uth: number | null = null
  if (i.restingHr != null && i.restingHr > 0 && i.age != null) {
    const hrMax = i.measuredMaxHr ?? hrMaxFromAge(i.age)
    uth = clamp(15.3 * (hrMax / i.restingHr))
  }
  // Jackson NEX: needs age, weight, height, activity.
  let jax: number | null = null
  if (i.age != null && i.weightKg != null && i.heightCm != null && i.heightCm > 0 && i.activityLevel != null) {
    const bmi = i.weightKg / ((i.heightCm / 100) ** 2)
    jax = clamp(jacksonNonExercise({ age: i.age, sex: i.sex, bmi, activityLevel: i.activityLevel }))
  }
  if (uth != null) return { value: uth, method: 'uth-sorensen', crosscheck: jax }
  if (jax != null) return { value: jax, method: 'jackson-nex', crosscheck: null }
  return { value: null, method: null, crosscheck: null }
}
