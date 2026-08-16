// The 2026-07-28 step over-count: `steps` accumulates from the 0x33 accel stream while the posted
// window's end came from the 0x7e/0x7f GATE stream, which stalls whenever the ring power-gates its
// radio. Pairing them made a real count look impossible — 3,605 steps over a 12.5-minute window they
// need ~21 minutes to produce (289/min), and on disconnect with no gate frames the window collapses
// to 30 s for an entire burst.
//
// These pin the two halves of that: the counter's cadence bound, and the gate-derived collapse.
import { describe, it, expect } from 'vitest'
import { StepPeakCounter, MIN_STEP_GAP_SEC } from '../accel'
import { countGaitGatedSteps } from '../gait-step-count'
import { isPlausibleStepWindow } from '@trainingai/shared/health/step-estimate'
import { initialSnapshot, onGateWindow, onDisconnect } from '../step-orchestrator-core'

const walkingWindow = (ds: number) => ({ ds, columns: Array.from({ length: 27 }, (_, i) => (i === 14 ? 5 : 50)) })

describe('StepPeakCounter — cadence is bounded by the accel it processed', () => {
  it('cannot exceed the refractory even on a maximal spike train', () => {
    const c = new StepPeakCounter()
    c.setSampleRate(50)
    for (let i = 0; i < 50 * 60; i++) c.add(i % 2 === 0 ? 1000 : 100) // 60 s, alternating hard
    expect(c.elapsedSec).toBe(60)
    expect(c.count / c.elapsedSec!).toBeLessThanOrEqual(1 / MIN_STEP_GAP_SEC)
  })

  it('reports the accel seconds behind the count, so the two can be paired honestly', () => {
    const c = new StepPeakCounter()
    expect(c.elapsedSec).toBeNull() // no rate byte seen yet — nothing to measure against
    c.setSampleRate(50)
    for (let i = 0; i < 500; i++) c.add(100)
    expect(c.elapsedSec).toBe(10)
  })

  it('forgets its rate on reset, so a new burst cannot inherit the last one’s time base', () => {
    const c = new StepPeakCounter()
    c.setSampleRate(50)
    c.add(100)
    c.reset()
    expect(c.elapsedSec).toBeNull()
  })
})

describe('orchestrator core — the gate-derived window end is the defect', () => {
  it('collapses a whole burst to 30 s when gate frames stall before a disconnect', () => {
    const started = onGateWindow({ ...initialSnapshot(), lastKnownDs: 0 }, walkingWindow(0), { liveHrActive: false, nowMs: 0 })
    expect(started.snapshot.state).toBe('counting')
    // No further gate windows arrive — the ring power-gated. Then it disconnects.
    const posted = onDisconnect(started.snapshot).effects[0] as { startDs: number; endDs: number }
    // 30 s, however long counting really ran. The shell must NOT post a count against this span.
    expect(posted.endDs - posted.startDs).toBe(300)
  })

  it('3,605 steps is unreachable within the 12.5-minute window production stored it against', () => {
    const minAccelSec = 3605 * MIN_STEP_GAP_SEC
    expect(minAccelSec).toBeGreaterThan(12.5 * 60) // needs ~21 min — the window was the wrong part
  })
})

// The naive StepPeakCounter is accurate on real walking but also counts irregular hand motion —
// the owner's capture peak-counted 114 "steps" over 61 s of cooking with ZERO real steps
// (lib/oura-ble/gait-step-count.ts). That is ~112 steps/min, comfortably UNDER the cadence ceiling,
// so isPlausibleStepWindow cannot catch it. Until 2026-07-28 the orchestrator posted this ungated
// count on its DEFAULT path (gating ran only when auto-capture was on, which is off by default).
describe('the cadence gate cannot catch hand-motion false positives', () => {
  it('a 112 steps/min phantom count passes the plausibility gate', () => {
    // 114 "steps" over 61 s of cooking — the real measured false positive.
    expect(isPlausibleStepWindow(114, 0, 61_000)).toBe(true)
  })

  it('which is why the posted count must be gait-gated, not merely rate-checked', () => {
    // Irregular hand motion: alternating spike amplitudes with no sustained rhythm in the
    // 1.4-2.8 Hz band. The naive peak counter finds peaks; the gait gate rejects the window.
    const rate = 50
    const magnitudes: number[] = []
    for (let i = 0; i < rate * 60; i++) {
      // Aperiodic: period wanders every few samples, so no lag holds a strong autocorrelation.
      const period = 7 + (Math.floor(i / 37) % 11)
      magnitudes.push(i % period === 0 ? 1400 : 900)
    }
    const naive = new StepPeakCounter()
    naive.setSampleRate(rate)
    for (const m of magnitudes) naive.add(m)

    const gated = countGaitGatedSteps(magnitudes, rate)
    expect(naive.count).toBeGreaterThan(0)          // the naive counter credits this motion...
    expect(gated).toBeLessThan(naive.count)         // ...the gait gate does not
  })
})
