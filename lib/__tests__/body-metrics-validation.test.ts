import { describe, it, expect } from 'vitest'
import {
  BodyMetadataPostSchema,
  validWeightKgOrNull,
  WEIGHT_KG_MIN,
  WEIGHT_KG_MAX,
  validBodyFatPctOrNull,
  validCaloriesOrNull,
  validMacroGOrNull,
  validStepsOrNull,
  validDistanceKmOrNull,
} from '@trainingai/shared/validation/body-metrics'

describe('validWeightKgOrNull', () => {
  it('passes in-range weights through', () => {
    expect(validWeightKgOrNull(82.5)).toBe(82.5)
    expect(validWeightKgOrNull(WEIGHT_KG_MIN)).toBe(20)
    expect(validWeightKgOrNull(WEIGHT_KG_MAX)).toBe(500)
  })
  it('nulls out-of-range and non-finite values', () => {
    expect(validWeightKgOrNull(19.9)).toBeNull()
    expect(validWeightKgOrNull(500.1)).toBeNull()
    expect(validWeightKgOrNull(9999)).toBeNull()
    expect(validWeightKgOrNull(NaN)).toBeNull()
    expect(validWeightKgOrNull(Infinity)).toBeNull()
  })
})

describe('push-parity field validators (SYNC-P1)', () => {
  it('mirror the route schema bounds for bodyFat/calories/macros/steps/distanceKm', () => {
    expect(validBodyFatPctOrNull(18)).toBe(18)
    expect(validBodyFatPctOrNull(95)).toBeNull()
    expect(validBodyFatPctOrNull(0)).toBeNull()
    expect(validCaloriesOrNull(2500)).toBe(2500)
    expect(validCaloriesOrNull(100000)).toBeNull()
    expect(validCaloriesOrNull(-1)).toBeNull()
    expect(validMacroGOrNull(150)).toBe(150)
    expect(validMacroGOrNull(3000)).toBeNull()
    expect(validStepsOrNull(9200)).toBe(9200)
    expect(validStepsOrNull(1.5)).toBeNull()
    expect(validStepsOrNull(-1)).toBeNull()
    expect(validDistanceKmOrNull(5.2)).toBe(5.2)
    expect(validDistanceKmOrNull(2000)).toBeNull()
  })

  it('reject exactly the same payloads the route schema rejects (parity)', () => {
    const cases: [string, number][] = [
      ['bodyFat', 95],
      ['calories', 100000],
      ['steps', -1],
    ]
    for (const [field, value] of cases) {
      expect(BodyMetadataPostSchema.safeParse({ [field]: value }).success).toBe(false)
    }
    expect(validBodyFatPctOrNull(95)).toBeNull()
    expect(validCaloriesOrNull(100000)).toBeNull()
    expect(validStepsOrNull(-1)).toBeNull()
  })
})

describe('BodyMetadataPostSchema', () => {
  it('accepts a normal manual log', () => {
    const r = BodyMetadataPostSchema.safeParse({ localDate: '2026-07-01', weightKg: 82.5, bodyFat: 18, steps: 9200 })
    expect(r.success).toBe(true)
  })
  it('accepts nulls and omissions (partial upserts)', () => {
    expect(BodyMetadataPostSchema.safeParse({}).success).toBe(true)
    expect(BodyMetadataPostSchema.safeParse({ weightKg: null }).success).toBe(true)
  })
  it('accepts slash dates (legacy client format)', () => {
    expect(BodyMetadataPostSchema.safeParse({ localDate: '2026/07/01' }).success).toBe(true)
  })
  it('rejects out-of-range numbers', () => {
    expect(BodyMetadataPostSchema.safeParse({ weightKg: 5000 }).success).toBe(false)
    expect(BodyMetadataPostSchema.safeParse({ weightKg: 10 }).success).toBe(false)
    expect(BodyMetadataPostSchema.safeParse({ bodyFat: 95 }).success).toBe(false)
    expect(BodyMetadataPostSchema.safeParse({ steps: -1 }).success).toBe(false)
    expect(BodyMetadataPostSchema.safeParse({ steps: 1.5 }).success).toBe(false)
    expect(BodyMetadataPostSchema.safeParse({ calories: 100000 }).success).toBe(false)
    expect(BodyMetadataPostSchema.safeParse({ localDate: 'yesterday' }).success).toBe(false)
  })

  // Q-464. Zod drops an unknown key by default, so a mistyped or wrong-named field became a
  // SUCCESSFUL write of the wrong thing. Measured on this schema before `.strict()`:
  // `{"date":"2026-08-10","weightKg":81}` answered 200 and wrote the weight on TODAY, because the
  // contract's key is `localDate`. The same for a year-3026 date and for 'not-a-date' — all three
  // silently landed on today.
  it('rejects an unknown key instead of dropping it', () => {
    // The exact three that were measured landing on the wrong day.
    for (const date of ['2026-08-10', '3026-08-18', 'not-a-date']) {
      expect(BodyMetadataPostSchema.safeParse({ date, weightKg: 81 }).success).toBe(false)
    }
    // `waterIntake` is what the Water widget's web fallback actually sends, and water does not live
    // on this route at all (Q-472). It used to be discarded behind a 200.
    expect(BodyMetadataPostSchema.safeParse({ localDate: '2026-08-18', waterIntake: 750 }).success).toBe(false)
    // A typo'd known key is caught too, which is the general case.
    expect(BodyMetadataPostSchema.safeParse({ weightkg: 81 }).success).toBe(false)
  })

  it('still accepts every key its own clients send', () => {
    // metric-log-sheet.tsx sends { localDate, <LogField> }; log-value-sheet.tsx sends
    // { localDate, <MetaKey> }. Every one of those minus waterIntake, which is Q-472's bug.
    // A plausible value per field — the per-field bounds are asserted separately above, and reusing
    // one number here would fail on them rather than on strictness.
    const plausible: Record<string, number> = {
      weightKg: 82, steps: 9200, bodyFat: 18, calories: 2400,
      protein: 160, carb: 250, fat: 80, distanceKm: 6,
    }
    for (const [field, value] of Object.entries(plausible)) {
      const r = BodyMetadataPostSchema.safeParse({ localDate: '2026-08-18', [field]: value })
      expect(r.success, `${field} must remain accepted`).toBe(true)
    }
  })
})
