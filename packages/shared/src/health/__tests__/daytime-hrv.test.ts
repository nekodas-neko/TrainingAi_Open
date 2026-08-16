import { describe, it, expect } from 'vitest'
import { daytimeHrvCurve } from '@trainingai/shared/health/daytime-hrv'

describe('daytimeHrvCurve', () => {
  it('keeps samples outside every sleep interval, time-ordered', () => {
    const samples = [
      { tSec: 3_600, rmssd: 40 },   // 01:00 — inside sleep -> dropped
      { tSec: 32_400, rmssd: 55 },  // 09:00 — awake -> kept
      { tSec: 50_400, rmssd: 48 },  // 14:00 — awake -> kept
    ]
    const sleep = [{ startSec: 0, endSec: 27_000 }] // 00:00–07:30
    expect(daytimeHrvCurve(samples, sleep)).toEqual([
      { tSec: 32_400, rmssd: 55 },
      { tSec: 50_400, rmssd: 48 },
    ])
  })

  it('returns all samples when there is no sleep interval', () => {
    const samples = [{ tSec: 100, rmssd: 30 }]
    expect(daytimeHrvCurve(samples, [])).toEqual([{ tSec: 100, rmssd: 30 }])
  })

  it('sorts out-of-order samples by time', () => {
    const out = daytimeHrvCurve([{ tSec: 200, rmssd: 2 }, { tSec: 100, rmssd: 1 }], [])
    expect(out.map(p => p.tSec)).toEqual([100, 200])
  })
})
