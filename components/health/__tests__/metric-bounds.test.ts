// Q-321: the bounds a user-typed metric is checked against before it is queued.
import { describe, it, expect } from 'vitest'
import { metricBoundError, hasMetricBound } from '../metric-bounds'
import {
  WEIGHT_KG_MIN, WEIGHT_KG_MAX,
  BODY_FAT_PCT_MIN, BODY_FAT_PCT_MAX,
  STEPS_MIN, STEPS_MAX,
  CALORIES_MAX, MACRO_G_MAX, WATER_ML_DELTA_MAX,
} from '@trainingai/shared/validation/body-metrics'

describe('metricBoundError', () => {
  it('accepts a value inside the bound', () => {
    expect(metricBoundError('weightKg', '82.4')).toBeNull()
    expect(metricBoundError('bodyFat', '18')).toBeNull()
    expect(metricBoundError('steps', '8000')).toBeNull()
    expect(metricBoundError('calories', '2100')).toBeNull()
    expect(metricBoundError('protein', '150')).toBeNull()
    expect(metricBoundError('waterIntake', '500')).toBeNull()
  })

  // The case that motivated the entry: accepted by the sheet, stored, queued, pushed, and
  // discarded server-side, with the typed number appearing nowhere afterwards.
  it('rejects the 5,000 kg weight that used to be queued and silently dropped', () => {
    expect(metricBoundError('weightKg', '5000')).toMatch(/between 20 and 500 kg/)
  })

  it('names the actual bound rather than a generic message', () => {
    expect(metricBoundError('bodyFat', '95')).toContain(String(BODY_FAT_PCT_MAX))
    expect(metricBoundError('weightKg', '1')).toContain(String(WEIGHT_KG_MIN))
    expect(metricBoundError('calories', '99999')).toContain(CALORIES_MAX.toLocaleString())
    expect(metricBoundError('protein', '9999')).toContain(MACRO_G_MAX.toLocaleString())
    expect(metricBoundError('steps', '999999')).toContain(STEPS_MAX.toLocaleString())
  })

  it('holds each boundary inclusive, on both ends', () => {
    for (const [field, min, max] of [
      ['weightKg', WEIGHT_KG_MIN, WEIGHT_KG_MAX],
      ['bodyFat', BODY_FAT_PCT_MIN, BODY_FAT_PCT_MAX],
      ['steps', STEPS_MIN, STEPS_MAX],
    ] as const) {
      expect(metricBoundError(field, String(min)), `${field} min`).toBeNull()
      expect(metricBoundError(field, String(max)), `${field} max`).toBeNull()
      expect(metricBoundError(field, String(min - 1)), `${field} below min`).not.toBeNull()
      expect(metricBoundError(field, String(max + 1)), `${field} above max`).not.toBeNull()
    }
  })

  // STEPS_MIN is 0, and the old `valueNum <= 0` check rejected it. Pinned so a future "must be
  // positive" simplification cannot quietly reintroduce a disagreement with the server.
  it('accepts zero steps, which the check it replaced refused', () => {
    expect(STEPS_MIN).toBe(0)
    expect(metricBoundError('steps', '0')).toBeNull()
  })

  // A water ENTRY is an increment, and its validator quarantines rather than coerces — so an
  // out-of-range value dead-letters into a badge the user cannot clear. Strictly positive.
  it('is strictly positive for water, and capped at the delta bound', () => {
    expect(metricBoundError('waterIntake', '0')).not.toBeNull()
    expect(metricBoundError('waterIntake', String(WATER_ML_DELTA_MAX))).toBeNull()
    expect(metricBoundError('waterIntake', String(WATER_ML_DELTA_MAX + 1))).not.toBeNull()
    expect(metricBoundError('waterMlDelta', '9000')).not.toBeNull()
  })

  it('treats an empty entry as unfinished, not wrong', () => {
    expect(metricBoundError('weightKg', '')).toBeNull()
    expect(metricBoundError('weightKg', '   ')).toBeNull()
  })

  it('rejects a non-number', () => {
    expect(metricBoundError('weightKg', 'abc')).toBe('Enter a number')
  })

  // A new field arriving without an entry here must stay saveable rather than become unsaveable.
  it('passes a field it has no bound for', () => {
    expect(metricBoundError('someFutureField', '999999')).toBeNull()
    expect(hasMetricBound('someFutureField')).toBe(false)
    expect(hasMetricBound('weightKg')).toBe(true)
  })

  // Every field the three sheets can pass must be covered, or this guard is a no-op for it. The
  // lists are the `fieldMap`/`widgetToLocal` keys in metric-log-sheet and log-value-sheet.
  it('covers every user-typed field the three sheets write', () => {
    for (const field of ['weightKg', 'bodyFat', 'steps',
                         'calories', 'protein', 'carb', 'fat', 'waterIntake']) {
      expect(hasMetricBound(field), `${field} has no bound`).toBe(true)
    }
  })
})
