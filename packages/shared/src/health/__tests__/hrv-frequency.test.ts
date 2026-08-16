import { describe, it, expect } from 'vitest'
import { lfhfFromIbi } from '../hrv-frequency'

// Build an IBI stream whose tachogram carries a known oscillation frequency `fHz`. Beats sit ~1 s
// apart (base 1000 ms), so beat index ≈ seconds; a sinusoid in the IBI value injects power at fHz.
function ibiWithOscillation(fHz: number, nBeats: number, ampMs = 60): number[] {
  const out: number[] = []
  let tSec = 0
  for (let i = 0; i < nBeats; i++) {
    const ibi = 1000 + ampMs * Math.sin(2 * Math.PI * fHz * tSec)
    out.push(ibi)
    tSec += ibi / 1000
  }
  return out
}

describe('lfhfFromIbi', () => {
  it('returns nulls on too-few / too-short input', () => {
    expect(lfhfFromIbi([]).lfhf).toBeNull()
    expect(lfhfFromIbi(Array(50).fill(1000)).lfhf).toBeNull() // < 90 beats
  })

  it('returns null on a flat tachogram (no resolvable HF power)', () => {
    // 300 constant beats: enough beats/span, but zero variability → no band power.
    expect(lfhfFromIbi(Array(300).fill(1000)).lfhf).toBeNull()
  })

  it('an HF-band oscillation yields a LOWER LF/HF than an LF-band oscillation', () => {
    const hf = lfhfFromIbi(ibiWithOscillation(0.25, 300)) // 0.25 Hz → HF band
    const lf = lfhfFromIbi(ibiWithOscillation(0.08, 300)) // 0.08 Hz → LF band
    expect(hf.lfhf).not.toBeNull()
    expect(lf.lfhf).not.toBeNull()
    expect(hf.lfhf!).toBeLessThan(1)      // power in HF → small ratio
    expect(lf.lfhf!).toBeGreaterThan(1)   // power in LF → large ratio
    expect(lf.lfhf!).toBeGreaterThan(hf.lfhf!)
  })

  it('reports non-negative band powers and clips the ratio', () => {
    const r = lfhfFromIbi(ibiWithOscillation(0.08, 300))
    expect(r.lf!).toBeGreaterThanOrEqual(0)
    expect(r.hf!).toBeGreaterThanOrEqual(0)
    expect(r.lfhf!).toBeLessThanOrEqual(20)
  })
})
