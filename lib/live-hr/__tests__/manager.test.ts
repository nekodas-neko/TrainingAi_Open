// lib/live-hr/__tests__/manager.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createLiveHrManager } from '@/lib/live-hr/manager'
import type { LiveHrDiagnostics, LiveHrSample, LiveHrSource, LiveHrSourceId, SourceConnectionState } from '@/lib/live-hr/types'

// A fake source the test can drive: push samples + flip connection state.
function fakeSource(id: LiveHrSourceId, state: SourceConnectionState = 'connected') {
  let cb: ((s: Omit<LiveHrSample, 'sourceId'>) => void) | null = null
  const src: LiveHrSource = {
    id,
    connectionState: () => state,
    start: async () => {},
    stop: async () => {},
    subscribe: (fn) => { cb = fn; return () => { cb = null } },
  }
  return { src, push: (bpm: number, at = 1) => cb?.({ bpm, at }), setState: (s: SourceConnectionState) => { state = s } }
}

describe('liveHrManager', () => {
  it('stores the latest sample and notifies subscribers', async () => {
    const ring = fakeSource('oura_ble')
    const mgr = createLiveHrManager([ring.src])
    const seen: number[] = []
    mgr.subscribe(s => seen.push(s.bpm))
    await mgr.start()
    ring.push(88, 100)
    expect(mgr.getCurrent()).toEqual({ bpm: 88, at: 100, sourceId: 'oura_ble' })
    expect(seen).toEqual([88])
  })

  it('prefers the chest strap over the ring when both are connected', async () => {
    const ring = fakeSource('oura_ble', 'connected')
    const strap = fakeSource('chest_strap', 'connected')
    // Registration order is precedence order: strap first.
    const mgr = createLiveHrManager([strap.src, ring.src])
    await mgr.start()
    expect(mgr.activeSourceId()).toBe('chest_strap')
  })

  it('falls back to the ring when the strap is disconnected', async () => {
    const ring = fakeSource('oura_ble', 'connected')
    const strap = fakeSource('chest_strap', 'disconnected')
    const mgr = createLiveHrManager([strap.src, ring.src])
    await mgr.start()
    expect(mgr.activeSourceId()).toBe('oura_ble')
  })

  it('clears the current sample on stop', async () => {
    const ring = fakeSource('oura_ble')
    const mgr = createLiveHrManager([ring.src])
    await mgr.start()
    ring.push(90)
    await mgr.stop()
    expect(mgr.getCurrent()).toEqual({ bpm: null, at: null, sourceId: null })
  })

  it('returns null diagnostics when no source can self-report', async () => {
    const ring = fakeSource('oura_ble')
    const mgr = createLiveHrManager([ring.src])
    await mgr.start()
    expect(mgr.getDiagnostics()).toBeNull()
  })

  it('surfaces the connected source diagnostics when available', async () => {
    const diag: LiveHrDiagnostics = {
      sourceId: 'oura_ble', connectionState: 'connecting',
      framesSeen: 12, hrFramesSeen: 3, decodeHits: 0,
      tagCounts: { '0x86': 3, '0x41': 9 }, lastBpm: null, lastBpmAt: null, sampleHexes: ['86…'],
    }
    const ring = fakeSource('oura_ble', 'connecting')
    const src: LiveHrSource = { ...ring.src, getDiagnostics: () => diag }
    const mgr = createLiveHrManager([src])
    await mgr.start()
    expect(mgr.getDiagnostics()).toEqual(diag)
  })
})

// Lifecycle-tracking fake for the ambient/workout decoupling. `connectionState`
// is decoupled from start()/stop() (call .connect() to simulate the BLE
// handshake completing) — real connects aren't instant, and the ring-gating
// tests below need to distinguish "started" from "actually connected".
class LifecycleSource implements LiveHrSource {
  startCount = 0
  stopCount = 0
  ambientCalls: boolean[] = []
  state: SourceConnectionState = 'disconnected'
  constructor(readonly id: LiveHrSourceId, private readonly supportsAmbient = false) {}
  connectionState() { return this.state }
  async start() { this.startCount++ }
  async stop() { this.stopCount++; this.state = 'disconnected' }
  subscribe() { return () => {} }
  setAmbient(v: boolean) { if (this.supportsAmbient) this.ambientCalls.push(v) }
  get running() { return this.startCount > this.stopCount }
  connect() { this.state = 'connected' }
}

describe('liveHrManager — ambient vs workout decoupling', () => {
  const setup = () => {
    const strap = new LifecycleSource('chest_strap', true)
    const ring = new LifecycleSource('oura_ble')
    return { strap, ring, mgr: createLiveHrManager([strap, ring]) }
  }

  it('startAmbient starts only the strap, never the ring', async () => {
    const { strap, ring, mgr } = setup()
    await mgr.startAmbient()
    expect(strap.running).toBe(true)
    expect(ring.startCount).toBe(0)
    expect(mgr.isRunning()).toBe(false)
  })

  it('a workout escalates the ring on top of ambient when the strap has not connected yet', async () => {
    const { strap, ring, mgr } = setup()
    await mgr.startAmbient()
    // strap.start() ran (ambient), but the BLE handshake hasn't completed —
    // the ring must cover in the meantime, same as if there were no strap at all.
    await mgr.start()
    expect(ring.running).toBe(true)
    expect(strap.startCount).toBe(1) // not double-started
    expect(mgr.isRunning()).toBe(true)
    await mgr.stop()
    expect(ring.running).toBe(false)
    expect(strap.running).toBe(true) // ambient still holds it
    expect(mgr.isRunning()).toBe(false)
  })

  it('a workout does NOT escalate the ring when the ambient strap is already connected', async () => {
    const { strap, ring, mgr } = setup()
    await mgr.startAmbient()
    strap.connect()
    await mgr.start()
    // isRunning() (the workout PATH) is true even though the ring itself never
    // starts — the strap is already covering, so escalating the ring on top of
    // it would be pure battery waste with zero benefit (TMR-1's read-path
    // precedence means the ring's beats would never even be surfaced).
    expect(mgr.isRunning()).toBe(true)
    expect(ring.running).toBe(false)
    await mgr.stop()
  })

  it('without ambient, a workout drives the strap and the ring covers until the strap connects', async () => {
    const { strap, ring, mgr } = setup()
    await mgr.start()
    expect(strap.running).toBe(true)
    expect(ring.running).toBe(true) // strap not connected yet — ring covers
    await mgr.stop()
    expect(strap.running || ring.running).toBe(false)
  })

  it('de-escalates the ring once the strap connects mid-workout (periodic re-check)', async () => {
    vi.useFakeTimers()
    try {
      const { strap, ring, mgr } = setup()
      await mgr.start()
      expect(ring.running).toBe(true) // strap not connected yet
      strap.connect()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(ring.running).toBe(false) // periodic reconcile noticed the strap and backed off
      await mgr.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-escalates the ring if the strap drops mid-workout (periodic re-check)', async () => {
    vi.useFakeTimers()
    try {
      const { strap, ring, mgr } = setup()
      await mgr.startAmbient()
      strap.connect()
      await mgr.start()
      expect(ring.running).toBe(false)
      strap.state = 'disconnected' // taken off / out of range mid-workout
      await vi.advanceTimersByTimeAsync(10_000)
      expect(ring.running).toBe(true)
      await mgr.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops the periodic re-check timer on stop (no reconcile after the workout ends)', async () => {
    vi.useFakeTimers()
    try {
      const { ring, mgr } = setup()
      await mgr.start()
      await mgr.stop()
      const startCountAfterStop = ring.startCount
      // If the timer weren't cleared, this would eventually re-evaluate wants()
      // and could re-start the ring even though the workout path is off.
      await vi.advanceTimersByTimeAsync(60_000)
      expect(ring.startCount).toBe(startCountAfterStop)
      expect(ring.running).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stopAmbient stops the strap only when no workout is active', async () => {
    const { strap, mgr } = setup()
    await mgr.startAmbient()
    await mgr.start()
    await mgr.stopAmbient()
    expect(strap.running).toBe(true)
    await mgr.stop()
    expect(strap.running).toBe(false)
  })

  it('thins strap persistence in ambient, full 1 Hz during a workout', async () => {
    const { strap, mgr } = setup()
    await mgr.startAmbient()
    expect(strap.ambientCalls.at(-1)).toBe(true)
    await mgr.start()
    expect(strap.ambientCalls.at(-1)).toBe(false)
    await mgr.stop()
    expect(strap.ambientCalls.at(-1)).toBe(true)
  })

  it('is idempotent — repeated startAmbient/start do not double-start', async () => {
    const { strap, ring, mgr } = setup()
    await mgr.startAmbient()
    await mgr.startAmbient()
    await mgr.start()
    await mgr.start()
    expect(strap.startCount).toBe(1)
    expect(ring.startCount).toBe(1)
  })
})

// The strap gives up on an unreachable link by design (native service ~4 min, WebView fallback
// ~17 s). startAmbient() is guarded by `ambientWanted`, so once ambient is on it can never revive
// a dead link — retryAmbient() is the only path back, and before it existed an app restart was
// the only way to connect a strap put on after launch.
describe('liveHrManager — retryAmbient', () => {
  class RetrySource extends LifecycleSource {
    retryCount = 0
    async retry() { this.retryCount++ }
  }
  const setup = () => {
    const strap = new RetrySource('chest_strap', true)
    const ring = new RetrySource('oura_ble')
    return { strap, ring, mgr: createLiveHrManager([strap, ring]) }
  }

  it('re-arms the ambient strap without restarting it', async () => {
    const { strap, mgr } = setup()
    await mgr.startAmbient()
    await mgr.retryAmbient()
    expect(strap.retryCount).toBe(1)
    expect(strap.startCount).toBe(1) // re-armed in place, not torn down and restarted
  })

  it('never retries a workout-only source — the ring must not be woken by an ambient tick', async () => {
    const { ring, mgr } = setup()
    await mgr.startAmbient()
    await mgr.retryAmbient()
    expect(ring.retryCount).toBe(0)
    expect(ring.startCount).toBe(0)
  })

  it('is inert when nothing wants a source, so the foreground tick costs nothing unpaired', async () => {
    const { strap, mgr } = setup()
    await mgr.retryAmbient()
    expect(strap.retryCount).toBe(0)
    expect(strap.startCount).toBe(0)
  })

  it('recovers a source whose start() threw — otherwise nothing re-runs reconcile', async () => {
    const strap = new RetrySource('chest_strap', true)
    let failFirst = true
    strap.start = async () => {
      if (failFirst) { failFirst = false; throw new Error('bluetooth off') }
      strap.startCount++
    }
    const mgr = createLiveHrManager([strap])
    await mgr.startAmbient().catch(() => {})
    expect(strap.startCount).toBe(0) // stranded: ambient is wanted, but nothing is started
    await mgr.retryAmbient()
    expect(strap.startCount).toBe(1)
  })

  it('does not re-reconcile once everything is started — the tick must stay cheap', async () => {
    const { strap, mgr } = setup()
    await mgr.startAmbient()
    const before = strap.ambientCalls.length
    await mgr.retryAmbient()
    await mgr.retryAmbient()
    expect(strap.ambientCalls.length).toBe(before)
  })

  it('survives a source whose retry throws — one bad source must not break the tick', async () => {
    const strap = new RetrySource('chest_strap', true)
    strap.retry = async () => { throw new Error('BLE unavailable') }
    const mgr = createLiveHrManager([strap])
    await mgr.startAmbient()
    await expect(mgr.retryAmbient()).resolves.toBeUndefined()
  })

  it('retries during a workout too — the strap is wanted then as well', async () => {
    const { strap, mgr } = setup()
    await mgr.start()
    await mgr.retryAmbient()
    expect(strap.retryCount).toBe(1)
  })
})
