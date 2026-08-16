// Q-149: `adequate` used to short-circuit to `true` whenever the sampled HR at log time was below
// 120 bpm. Measured over production (615 rows, 2026-08-08) that branch absorbed everything — 278
// verdicts, all true, 271 of them (97.5%) via the shortcut — because the ring's highest recorded
// end-of-set HR in the entire dataset is 128. The flag answered "was the sampled HR below 120?",
// not "did you recover?", and a constant is worse than an absence: a reader cannot tell it apart
// from a signal.
import { describe, it, expect } from 'vitest'
import { analyseHrRecovery, ADEQUATE_HRR1_BPM, type HrReading } from '../hr-analysis'

const T0 = new Date('2026-08-08T02:00:00Z')
const at = (offsetSec: number, bpm: number): HrReading =>
  ({ timestamp: new Date(T0.getTime() + offsetSec * 1000), bpm })
const set = (loggedAt: Date) => ({ exerciseName: 'Bench', setNumber: 1, loggedAt })

describe('analyseHrRecovery — adequate rest requires a measured recovery (Q-149)', () => {
  it('is true when HR actually fell by the threshold within 60s', () => {
    const readings = [at(0, 150), at(60, 150 - ADEQUATE_HRR1_BPM)]
    expect(analyseHrRecovery(readings, [set(T0)])[0].adequate).toBe(true)
  })

  it('is false when the measured drop falls short', () => {
    const readings = [at(0, 150), at(60, 150 - (ADEQUATE_HRR1_BPM - 1))]
    expect(analyseHrRecovery(readings, [set(T0)])[0].adequate).toBe(false)
  })

  it('no longer returns true just because the sampled HR was under 120', () => {
    // The production shape: one lonely low reading at log time and nothing 60s later, which is
    // what a ring sampling at 1/min while power-gated actually produces. This used to be `true`.
    const readings = [at(0, 94)]
    const row = analyseHrRecovery(readings, [set(T0)])[0]
    expect(row.bpmAtLog).toBe(94)
    expect(row.hrr1).toBeNull()
    expect(row.adequate).toBeNull()
  })

  it('judges a low-HR set on its recovery like any other', () => {
    // Below the old 120 shortcut, but HR did not come down — previously an automatic pass.
    const readings = [at(0, 110), at(60, 108)]
    expect(analyseHrRecovery(readings, [set(T0)])[0].adequate).toBe(false)
  })

  it('is null when the set has no log time at all', () => {
    expect(analyseHrRecovery([at(0, 150)], [{ exerciseName: 'Bench', setNumber: 1, loggedAt: null }])[0].adequate).toBeNull()
  })
})
