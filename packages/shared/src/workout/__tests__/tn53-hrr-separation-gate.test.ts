import { describe, expect, it } from 'vitest'
import {
  analyseHrRecovery, HRR1_SEPARATION_MAX_MS, HRR1_SEPARATION_MIN_MS,
} from '@trainingai/shared/workout/hr-analysis'

// TN-53. `hrr1` means "the drop 60 s after the set", but nothing checked that the two readings it
// differences were 60 s apart — only that each sat near its own target (±90 s for `bpmAtLog`,
// ±45 s around log+60 s for `bpm60`). At chest-strap density (~1 reading/s, 111.8 per set in
// production) the pair lands at ~60 s by construction; at ring density (7.1 per set) it does not,
// and the same reading can serve both terms and report a drop of 0.
//
// The gate is on the measurement rather than on a reading count, because a count both over- and
// under-rejects: a sparse set whose two readings happen to be 60 s apart CAN measure HRR, and a
// dense set whose readings cluster on one side cannot.

const LOG = new Date('2026-09-20T10:00:00.000Z')

const r = (offsetSec: number, bpm: number) => ({
  timestamp: new Date(LOG.getTime() + offsetSec * 1000), bpm,
})

const oneSet = [{ exerciseName: 'Bench', setNumber: 1, loggedAt: LOG }]

const hrrOf = (readings: { timestamp: Date; bpm: number }[]) =>
  analyseHrRecovery(readings, oneSet)[0].hrr1

describe('TN-53 — HRR-60 requires its two readings to actually be ~60 s apart', () => {
  it('measures the drop when the readings straddle 60 s, as a chest strap always will', () => {
    // 1 Hz for two minutes: both terms land within a second of their targets.
    const dense = Array.from({ length: 120 }, (_, i) => r(i, 160 - i * 0.5))
    const hrr = hrrOf(dense)
    expect(hrr).not.toBeNull()
    // 160 at t=0 against ~130 at t=60 — a real 60-second drop.
    expect(hrr!).toBeGreaterThan(25)
    expect(hrr!).toBeLessThan(35)
  })

  it('refuses when ONE reading would serve both terms — the ring case that motivated this', () => {
    // A single reading at +30 s is within ±90 s of the log AND within ±45 s of log+60, so before
    // TN-53 both terms resolved to it and hrr1 was 160 − 160 = 0: a fabricated "no recovery".
    expect(hrrOf([r(30, 160)])).toBeNull()
  })

  it('refuses a pair that is too close together', () => {
    // 20 s apart. Before TN-53 this reported the 20-second drop as if it were the 60-second one.
    expect(hrrOf([r(0, 160), r(20, 150)])).toBeNull()
  })

  it('refuses a pair that is too far apart', () => {
    // 100 s apart — inside each term's own tolerance, outside the definition.
    expect(hrrOf([r(-40, 170), r(60, 130)])).toBeNull()
  })

  it('accepts exactly at both bounds and refuses just outside them', () => {
    // The boundary is asserted from the constants rather than restated, so widening the gate
    // cannot leave a test that still claims the old edge.
    const minS = HRR1_SEPARATION_MIN_MS / 1000
    const maxS = HRR1_SEPARATION_MAX_MS / 1000
    expect(hrrOf([r(0, 160), r(minS, 140)])).toBe(20)
    expect(hrrOf([r(0, 160), r(maxS, 140)])).toBe(20)
    expect(hrrOf([r(0, 160), r(minS - 1, 140)])).toBeNull()
    expect(hrrOf([r(0, 160), r(maxS + 1, 140)])).toBeNull()
  })

  it('leaves a null hrr1 as null rather than as an "adequate rest" claim', () => {
    // `adequate` is derived from hrr1 and feeds rest advice. A refused measurement must not read
    // as a passed one.
    const [stats] = analyseHrRecovery([r(30, 160)], oneSet)
    expect(stats.hrr1).toBeNull()
    expect(stats.adequate).toBeNull()
  })

  it('still reports peakBpm and bpmAtLog when the HRR itself is refused', () => {
    // The gate is on the 60-second drop only. Throwing away the readings we do have would lose
    // real information — the peak and the at-log value are measured, not inferred.
    const [stats] = analyseHrRecovery([r(30, 160)], oneSet)
    expect(stats.bpmAtLog).toBe(160)
    expect(stats.peakBpm).toBe(160)
  })
})
