import { describe, it, expect } from 'vitest'
import { intradaySpo2Curve } from '@trainingai/shared/health/intraday-spo2'
import { spo2PctFromR } from '@/lib/oura-ble/spo2'

describe('intradaySpo2Curve', () => {
  it('converts each frame R to SpO₂ % via spo2PctFromR, sorted by time', () => {
    const samples = [
      { tSec: 300, r: 0.9 },
      { tSec: 100, r: 0.8 },
    ]
    expect(intradaySpo2Curve(samples)).toEqual([
      { tSec: 100, spo2: spo2PctFromR(0.8) },
      { tSec: 300, spo2: spo2PctFromR(0.9) },
    ])
  })

  it('drops frames whose R is non-physical (spo2PctFromR → null)', () => {
    const out = intradaySpo2Curve([{ tSec: 100, r: 0 }, { tSec: 200, r: 0.85 }])
    expect(out.map(p => p.tSec)).toEqual([200])
  })

  it('returns an empty curve for no samples', () => {
    expect(intradaySpo2Curve([])).toEqual([])
  })
})
