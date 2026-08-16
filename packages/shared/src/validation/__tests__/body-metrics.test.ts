import { describe, it, expect } from 'vitest'
import { validMeasurementCmOrNull, MEASUREMENT_CM_MIN, MEASUREMENT_CM_MAX } from '@trainingai/shared/validation/body-metrics'

describe('validMeasurementCmOrNull', () => {
  it('accepts values within the sane bounds', () => {
    expect(validMeasurementCmOrNull(80)).toBe(80)
    expect(validMeasurementCmOrNull(MEASUREMENT_CM_MIN)).toBe(MEASUREMENT_CM_MIN)
    expect(validMeasurementCmOrNull(MEASUREMENT_CM_MAX)).toBe(MEASUREMENT_CM_MAX)
  })

  it('rejects values outside the sane bounds', () => {
    expect(validMeasurementCmOrNull(MEASUREMENT_CM_MIN - 1)).toBeNull()
    expect(validMeasurementCmOrNull(MEASUREMENT_CM_MAX + 1)).toBeNull()
  })

  it('rejects non-finite input', () => {
    expect(validMeasurementCmOrNull(NaN)).toBeNull()
    expect(validMeasurementCmOrNull(Infinity)).toBeNull()
  })
})
