import { describe, it, expect } from 'vitest'
import { intradayTempCurve, SKIN_MIN_C } from '@trainingai/shared/health/intraday-temp'

describe('intradayTempCurve', () => {
  it('drops sub-skin-range (off-finger) samples and sorts by time', () => {
    const samples = [
      { tSec: 200, tempC: 20.0 },  // ambient / off finger -> dropped (< SKIN_MIN_C)
      { tSec: 100, tempC: 33.5 },  // worn -> kept
      { tSec: 300, tempC: 34.1 },  // worn -> kept
    ]
    expect(intradayTempCurve(samples)).toEqual([
      { tSec: 100, tempC: 33.5 },
      { tSec: 300, tempC: 34.1 },
    ])
  })

  it('exposes the skin-range floor used by the wear-time gate (31 °C)', () => {
    expect(SKIN_MIN_C).toBe(31)
  })

  it('returns an empty curve when nothing is in range', () => {
    expect(intradayTempCurve([{ tSec: 1, tempC: 22 }])).toEqual([])
  })
})
