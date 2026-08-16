import { describe, it, expect } from 'vitest'
import { breathingFromIbi } from '@trainingai/shared/health/breathing-rate'

// Build a synthetic IBI sequence whose tachogram oscillates with breathing: instantaneous IBI =
// base + amp·sin(phase), phase advancing at the (possibly time-varying) breathing frequency.
function synthIbi(spanS: number, freqHzOf: (tMs: number) => number, base = 1000, amp = 60): number[] {
  const out: number[] = []
  let t = 0, phase = 0
  const spanMs = spanS * 1000
  while (t < spanMs) {
    const ibi = base + amp * Math.sin(phase)
    out.push(ibi)
    phase += 2 * Math.PI * freqHzOf(t) * (ibi / 1000)
    t += ibi
  }
  return out
}

describe('breathingFromIbi', () => {
  it('returns nulls when the beat stream is too short', () => {
    expect(breathingFromIbi([950, 1000, 1050, 1000])).toEqual({ rateBrpm: null, variability: null })
  })

  it('reports a plausible rate for steady breathing', () => {
    const ibi = synthIbi(300, () => 0.25) // 0.25 Hz = 15 breaths/min
    const r = breathingFromIbi(ibi)
    expect(r.rateBrpm).not.toBeNull()
    expect(r.rateBrpm!).toBeGreaterThan(9)
    expect(r.rateBrpm!).toBeLessThan(22)
  })

  it('scores irregular breathing as more variable than regular breathing', () => {
    const regular = breathingFromIbi(synthIbi(300, () => 0.25))
    // Alternating fast/slow breathing in ~6 s chunks → inter-breath intervals swing → high CV.
    const irregular = breathingFromIbi(synthIbi(300, (t) => (Math.floor(t / 6000) % 2 === 0 ? 0.33 : 0.15)))
    expect(regular.variability).not.toBeNull()
    expect(irregular.variability).not.toBeNull()
    expect(regular.variability!).toBeLessThan(0.2) // metronome breathing is tight
    expect(irregular.variability!).toBeGreaterThan(regular.variability!)
  })

  it('ignores non-physiological IBI artifacts', () => {
    const ibi = synthIbi(300, () => 0.25)
    ibi.splice(50, 0, 30000, 5) // a stalled beat + a spurious tiny interval
    const r = breathingFromIbi(ibi)
    expect(r.rateBrpm).not.toBeNull() // still derivable after filtering the artifacts
  })
})
