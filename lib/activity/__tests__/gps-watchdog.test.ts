import { describe, it, expect } from 'vitest'
import { evaluateWatchdog, WATCHER_MAX_MS, PROBE_HARD_MAX_MS, STALL_GAP_MS, NO_FIX_MAX_MS } from '../gps-watchdog'

const base = { nowMs: 1_000_000_000, gpsStartedMs: null as number | null, lastPointMs: null as number | null, sessionActive: false }

describe('evaluateWatchdog', () => {
  it('is a no-op while GPS is off', () => {
    expect(evaluateWatchdog(base)).toEqual({ action: 'none' })
  })
  it('force-stops any watcher older than the absolute cap, even mid-session', () => {
    const v = evaluateWatchdog({ ...base, gpsStartedMs: base.nowMs - WATCHER_MAX_MS - 1, lastPointMs: base.nowMs - 1000, sessionActive: true })
    expect(v).toEqual({ action: 'force-stop', reason: 'watcher-cap' })
  })
  it('force-stops a probe that outlived the hard probe cap without confirming a session', () => {
    const v = evaluateWatchdog({ ...base, gpsStartedMs: base.nowMs - PROBE_HARD_MAX_MS - 1 })
    expect(v).toEqual({ action: 'force-stop', reason: 'probe-timeout' })
  })
  it('leaves a young probe alone (the gate ticker owns the normal 3-min timeout)', () => {
    const v = evaluateWatchdog({ ...base, gpsStartedMs: base.nowMs - 60_000 })
    expect(v).toEqual({ action: 'none' })
  })
  it('ends a session whose last point is older than the stall gap', () => {
    const v = evaluateWatchdog({ ...base, gpsStartedMs: base.nowMs - 600_000, lastPointMs: base.nowMs - STALL_GAP_MS - 1, sessionActive: true })
    expect(v).toEqual({ action: 'end-session', reason: 'stall' })
  })
  it('does not end a session with fresh points', () => {
    const v = evaluateWatchdog({ ...base, gpsStartedMs: base.nowMs - 600_000, lastPointMs: base.nowMs - 30_000, sessionActive: true })
    expect(v).toEqual({ action: 'none' })
  })

  // #2477. A session confirmed by ring cadence, with the phone still indoors and no fix, never gets a
  // GPS point — and the stall check above needs a last point to be old, so it could not fire. GPS ran
  // to the 3.5 h cap (~3% battery an occurrence).
  describe('a confirmed session that never got a GPS point (#2477)', () => {
    const noFix = { ...base, sessionActive: true, lastPointMs: null }

    it('ends the session once the no-fix window has passed', () => {
      const v = evaluateWatchdog({ ...noFix, gpsStartedMs: base.nowMs - NO_FIX_MAX_MS - 1 })
      expect(v).toEqual({ action: 'end-session', reason: 'no-fix' })
    })

    it('waits out the window: a cold indoor fix can be slow', () => {
      expect(evaluateWatchdog({ ...noFix, gpsStartedMs: base.nowMs - NO_FIX_MAX_MS + 1000 })).toEqual({ action: 'none' })
      expect(evaluateWatchdog({ ...noFix, gpsStartedMs: base.nowMs - 60_000 })).toEqual({ action: 'none' })
    })

    it('outlasts the probe, so a walk confirmed at the end of the probe is not cut off at once', () => {
      // The gate probes for up to PROBE_HARD_MAX_MS before it gives up, and confirmation can land
      // anywhere inside it. The window must leave the confirmed session at least the stall gap.
      expect(NO_FIX_MAX_MS).toBeGreaterThanOrEqual(PROBE_HARD_MAX_MS + STALL_GAP_MS)
    })

    it('does not apply once a point has arrived: the stall rule owns that session', () => {
      const v = evaluateWatchdog({ ...noFix, gpsStartedMs: base.nowMs - NO_FIX_MAX_MS - 1, lastPointMs: base.nowMs - 10_000 })
      expect(v).toEqual({ action: 'none' })
    })

    it('does not apply to a probe that has not confirmed a session', () => {
      // The probe's own hard cap handles that case, with its own reason.
      const v = evaluateWatchdog({ ...base, gpsStartedMs: base.nowMs - NO_FIX_MAX_MS - 1 })
      expect(v).toEqual({ action: 'force-stop', reason: 'probe-timeout' })
    })

    it('still lets the absolute cap win', () => {
      const v = evaluateWatchdog({ ...noFix, gpsStartedMs: base.nowMs - WATCHER_MAX_MS - 1 })
      expect(v).toEqual({ action: 'force-stop', reason: 'watcher-cap' })
    })
  })
})
