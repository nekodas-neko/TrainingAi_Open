import { describe, it, expect } from 'vitest'
import { evaluateWatchdog, WATCHER_MAX_MS, PROBE_HARD_MAX_MS, STALL_GAP_MS } from '../gps-watchdog'

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
})
