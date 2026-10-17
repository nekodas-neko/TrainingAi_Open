/**
 * BMI and the category label under it. When a body-fat reading exists the label comes from body
 * fat % (BMI classifies muscle as excess weight), otherwise from the standard BMI bands.
 * One copy for both apps — this used to be written inline in each.
 */

export type BmiLabel =
  | 'Essential fat'
  | 'Athletic'
  | 'Fitness'
  | 'Average'
  | 'High fat'
  | 'Underweight'
  | 'Normal'
  | 'Overweight'
  | 'Obese'

export function bmiClassification(input: {
  weightKg: number | null | undefined
  heightCm: number | null | undefined
  bodyFatPct: number | null | undefined
  sex: string | null | undefined
}): { bmi: number | null; bmiUsesBf: boolean; bmiLabel: BmiLabel | null } {
  const { weightKg, heightCm, bodyFatPct, sex } = input
  const bmi =
    weightKg != null && heightCm != null && heightCm > 0
      ? weightKg / Math.pow(heightCm / 100, 2)
      : null
  const bmiUsesBf = bodyFatPct != null
  if (bmi == null) return { bmi, bmiUsesBf, bmiLabel: null }
  if (bodyFatPct != null) {
    const bf = bodyFatPct
    const bmiLabel: BmiLabel =
      sex === 'female'
        ? bf < 14 ? 'Essential fat' : bf < 21 ? 'Athletic' : bf < 25 ? 'Fitness' : bf < 32 ? 'Average' : 'High fat'
        : bf < 6 ? 'Essential fat' : bf < 14 ? 'Athletic' : bf < 18 ? 'Fitness' : bf < 25 ? 'Average' : 'High fat'
    return { bmi, bmiUsesBf, bmiLabel }
  }
  const bmiLabel: BmiLabel = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese'
  return { bmi, bmiUsesBf, bmiLabel }
}
