import { describe, it, expect } from 'vitest'
import {
  initialSnapshot, onGateWindow, onDisconnect, forceStart, forceStop,
  IDLE_STOP_STREAK, BURST_CAP_DS, COOLDOWN_MS,
  type OrchestratorSnapshot, type GateWindow,
} from '../step-orchestrator-core'
import { WALK_CADENCE_COLUMN } from '@trainingai/shared/health/step-estimate'

// Synthetic gate windows: a 27-column vector with only col14 set — matches how the
// real code reads columns[WALK_CADENCE_COLUMN].
function walkWindow(ds: number): GateWindow {
  const columns = new Array(27).fill(999)
  columns[WALK_CADENCE_COLUMN] = 5 // <= WALK_CADENCE_MAX (20)
  return { ds, columns }
}
function idleWindow(ds: number): GateWindow {
  const columns = new Array(27).fill(999)
  columns[WALK_CADENCE_COLUMN] = 50 // > WALK_CADENCE_MAX
  return { ds, columns }
}

const NOW = 1_700_000_000_000

describe('step orchestrator core — idle → counting', () => {
  it('a walking gate window triggers startAccel and enters counting', () => {
    const { snapshot, effects } = onGateWindow(initialSnapshot(), walkWindow(1000), { liveHrActive: false, nowMs: NOW })
    expect(snapshot.state).toBe('counting')
    expect(snapshot.countingStartDs).toBe(1000)
    expect(effects).toEqual([{ type: 'startAccel' }])
  })

  it('a non-walking gate window stays idle with no effects', () => {
    const { snapshot, effects } = onGateWindow(initialSnapshot(), idleWindow(1000), { liveHrActive: false, nowMs: NOW })
    expect(snapshot.state).toBe('idle')
    expect(effects).toEqual([])
  })

  it('never triggers while live-HR is active (radio courtesy)', () => {
    const { snapshot, effects } = onGateWindow(initialSnapshot(), walkWindow(1000), { liveHrActive: true, nowMs: NOW })
    expect(snapshot.state).toBe('idle')
    expect(effects).toEqual([])
  })
})

describe('step orchestrator core — counting → stop', () => {
  function countingFrom(ds: number): OrchestratorSnapshot {
    return onGateWindow(initialSnapshot(), walkWindow(ds), { liveHrActive: false, nowMs: NOW }).snapshot
  }

  it('two consecutive idle windows stop and post the burst', () => {
    let snap = countingFrom(1000)
    const r1 = onGateWindow(snap, idleWindow(1300), { liveHrActive: false, nowMs: NOW })
    expect(r1.snapshot.state).toBe('counting') // 1 idle window — not enough yet
    expect(r1.effects).toEqual([])
    snap = r1.snapshot

    const r2 = onGateWindow(snap, idleWindow(1600), { liveHrActive: false, nowMs: NOW })
    expect(r2.snapshot.state).toBe('cooldown')
    expect(r2.effects).toEqual([{ type: 'stopAndPost', startDs: 1000, endDs: 1900 }]) // 1600 + 300
  })

  it('a walking window resets the idle streak', () => {
    let snap = countingFrom(1000)
    snap = onGateWindow(snap, idleWindow(1300), { liveHrActive: false, nowMs: NOW }).snapshot
    snap = onGateWindow(snap, walkWindow(1600), { liveHrActive: false, nowMs: NOW }).snapshot
    expect(snap.state).toBe('counting')
    expect(snap.idleStreak).toBe(0)
    // Now needs two FRESH idle windows to stop.
    const r1 = onGateWindow(snap, idleWindow(1900), { liveHrActive: false, nowMs: NOW })
    expect(r1.snapshot.state).toBe('counting')
  })

  it('hits the 20-minute burst cap even while still walking', () => {
    const snap = countingFrom(0)
    const { snapshot, effects } = onGateWindow(snap, walkWindow(BURST_CAP_DS), { liveHrActive: false, nowMs: NOW })
    expect(snapshot.state).toBe('cooldown')
    expect(effects).toEqual([{ type: 'stopAndPost', startDs: 0, endDs: BURST_CAP_DS + 300 }])
  })

  it('a live-HR burst starting yields the radio immediately, regardless of streak', () => {
    const snap = countingFrom(1000)
    const { snapshot, effects } = onGateWindow(snap, walkWindow(1300), { liveHrActive: true, nowMs: NOW })
    expect(snapshot.state).toBe('cooldown')
    // The window that revealed live-HR is active isn't counted into the burst — it
    // ends at the last previously-accepted window (1000) + one gate span, not 1300's.
    expect(effects).toEqual([{ type: 'stopAndPost', startDs: 1000, endDs: 1300 }])
  })

  it('disconnect stops and posts an in-progress burst', () => {
    const snap = countingFrom(1000)
    const { snapshot, effects } = onDisconnect(snap)
    expect(snapshot.state).toBe('idle')
    expect(effects).toEqual([{ type: 'stopAndPost', startDs: 1000, endDs: 1300 }])
  })

  it('disconnect while idle is a no-op', () => {
    const { snapshot, effects } = onDisconnect(initialSnapshot())
    expect(snapshot.state).toBe('idle')
    expect(effects).toEqual([])
  })
})

describe('step orchestrator core — cooldown', () => {
  it('ignores gate windows during the cooldown window', () => {
    const stopped = onGateWindow(
      onGateWindow(initialSnapshot(), walkWindow(1000), { liveHrActive: false, nowMs: NOW }).snapshot,
      idleWindow(2000),
      { liveHrActive: false, nowMs: NOW },
    )
    // Force through a second idle window to actually enter cooldown.
    let snap = onGateWindow(initialSnapshot(), walkWindow(1000), { liveHrActive: false, nowMs: NOW }).snapshot
    snap = onGateWindow(snap, idleWindow(1300), { liveHrActive: false, nowMs: NOW }).snapshot
    const r = onGateWindow(snap, idleWindow(1600), { liveHrActive: false, nowMs: NOW })
    expect(r.snapshot.state).toBe('cooldown')
    expect(r.snapshot.cooldownUntilMs).toBe(NOW + COOLDOWN_MS)

    const duringCooldown = onGateWindow(r.snapshot, walkWindow(1900), { liveHrActive: false, nowMs: NOW + 1000 })
    expect(duringCooldown.snapshot.state).toBe('cooldown')
    expect(duringCooldown.effects).toEqual([])
    void stopped
  })

  it('resumes triggering once the cooldown elapses', () => {
    const cooldownSnap: OrchestratorSnapshot = {
      state: 'cooldown', countingStartDs: null, lastGateDs: null, lastKnownDs: 500,
      idleStreak: 0, cooldownUntilMs: NOW,
    }
    const { snapshot, effects } = onGateWindow(cooldownSnap, walkWindow(2000), { liveHrActive: false, nowMs: NOW + 1 })
    expect(snapshot.state).toBe('counting')
    expect(effects).toEqual([{ type: 'startAccel' }])
  })

  it('IDLE_STOP_STREAK is 2 (documentation guard against silent drift)', () => {
    expect(IDLE_STOP_STREAK).toBe(2)
  })
})

describe('step orchestrator core — explicit triggers (startTrackedWalk/stopTrackedWalk)', () => {
  it('forceStart requires a known ds and refuses while live-HR is active', () => {
    const noDs = forceStart(initialSnapshot(), { liveHrActive: false })
    expect(noDs.effects).toEqual([])

    const withDs: OrchestratorSnapshot = { ...initialSnapshot(), lastKnownDs: 5000 }
    const blocked = forceStart(withDs, { liveHrActive: true })
    expect(blocked.effects).toEqual([])

    const ok = forceStart(withDs, { liveHrActive: false })
    expect(ok.snapshot.state).toBe('counting')
    expect(ok.snapshot.countingStartDs).toBe(5000)
    expect(ok.effects).toEqual([{ type: 'startAccel' }])
  })

  it('forceStop posts the tracked burst and enters cooldown', () => {
    const counting: OrchestratorSnapshot = {
      state: 'counting', countingStartDs: 1000, lastGateDs: 1600, lastKnownDs: 1600,
      idleStreak: 0, cooldownUntilMs: null,
    }
    const { snapshot, effects } = forceStop(counting, { nowMs: NOW })
    expect(snapshot.state).toBe('cooldown')
    expect(effects).toEqual([{ type: 'stopAndPost', startDs: 1000, endDs: 1900 }])
  })

  it('forceStop while idle is a no-op', () => {
    const { snapshot, effects } = forceStop(initialSnapshot(), { nowMs: NOW })
    expect(snapshot.state).toBe('idle')
    expect(effects).toEqual([])
  })
})
