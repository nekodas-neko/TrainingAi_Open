// lib/live-hr/manager.ts
// Owns the set of live-HR sources, picks one active source by precedence
// (registration order = precedence; chest strap registered before the ring),
// starts/stops them, and exposes a single current-sample stream to the UI.
import type { LiveHrCurrent, LiveHrDiagnostics, LiveHrSample, LiveHrSource, LiveHrSourceId } from '@/lib/live-hr/types'
import { OuraRingSource } from '@/lib/live-hr/oura-ring-source'
import { ChestStrapSource } from '@/lib/live-hr/chest-strap-source'

export interface LiveHrManager {
  /** Workout path: escalate to full live HR (drives the ring's aggressive burst
   *  loop). Idempotent. Unchanged semantics for existing callers. */
  start(): Promise<void>
  stop(): Promise<void>
  /** Ambient path: keep the always-on sources (the chest strap) connected all day
   *  WITHOUT driving the ring's battery-costly burst loop. Idempotent. Coexists
   *  with start()/stop() — a workout can escalate on top of ambient, and ending it
   *  leaves the ambient strap running. */
  startAmbient(): Promise<void>
  stopAmbient(): Promise<void>
  /** Re-arm ambient sources that have given up on their connection. startAmbient() is guarded by
   *  `ambientWanted`, so once ambient is on it can never revive a dead link — this can. Safe to
   *  call on a timer: it delegates to the source's own idempotent retry. */
  retryAmbient(): Promise<void>
  subscribe(cb: (s: LiveHrSample) => void): () => void
  getCurrent(): LiveHrCurrent
  activeSourceId(): LiveHrSourceId | null
  /** Diagnostics from the highest-precedence source that can self-report, or null. */
  getDiagnostics(): LiveHrDiagnostics | null
  /** Force an immediate reading (user tapped "Measure"). No-op if no source supports it. */
  measureNow(): Promise<void>
  /** Drive live HR aggressively (true, during rest) or coast on the light fallback
   *  (false, during a set) — a battery lever. No-op if no source supports it. */
  setForced(forced: boolean): void
  /** True while the WORKOUT path is active — live-HR is actively driving the ring
   *  (CONNECTED_LIVE + the ~10 s DHR burst loop). Ambient-only (strap all day) is
   *  deliberately NOT "running" here: it never drives the ring. The step paths poll
   *  this and yield while it's true. */
  isRunning(): boolean
}

export function createLiveHrManager(
  sources: LiveHrSource[],
  // Sources that run in ambient (all-day) mode. Everything else is workout-only —
  // this is what keeps the ring's burst loop from running 24/7.
  ambientIds: Set<LiveHrSourceId> = new Set(['chest_strap']),
): LiveHrManager {
  let current: LiveHrCurrent = { bpm: null, at: null, sourceId: null }
  let subscribers: Array<(s: LiveHrSample) => void> = []
  let ambientWanted = false
  let workoutWanted = false
  // id → unsubscribe, present iff the source is currently started.
  const started = new Map<LiveHrSourceId, () => void>()
  // Re-checks source wanting while a workout is active (below) — no push notification
  // exists for a source's connectionState() changing (BLE connect/disconnect happens
  // deep in native code), so this is how the ring notices a strap that connects,
  // disconnects, or gets taken off mid-workout without the caller re-calling start().
  let workoutReconcileTimer: ReturnType<typeof setInterval> | null = null
  const WORKOUT_RECONCILE_MS = 10_000

  function activeSourceId(): LiveHrSourceId | null {
    // First (highest-precedence) source that isn't disconnected.
    const active = sources.find(s => s.connectionState() !== 'disconnected')
    return active?.id ?? null
  }

  function getDiagnostics(): LiveHrDiagnostics | null {
    const active = sources.find(s => s.connectionState() !== 'disconnected' && s.getDiagnostics)
    const reporter = active ?? sources.find(s => s.getDiagnostics)
    return reporter?.getDiagnostics?.() ?? null
  }

  async function measureNow(): Promise<void> {
    for (const s of sources) { if (s.measureNow) { await s.measureNow(); return } }
  }

  function setForced(forced: boolean): void {
    for (const s of sources) s.setForced?.(forced)
  }

  // A source runs if something wants it: ambient sources whenever ambient OR
  // workout is active; workout-only sources (the ring) only during a workout —
  // AND only when a higher-precedence ambient source (the strap) isn't already
  // connected. Escalating the ring's aggressive live loop (CONNECTED_LIVE + the
  // 10 s DHR burst) on top of an already-connected strap is pure ring-battery
  // waste: the strap already wins read-path precedence (activeSourceId), so the
  // ring's beats would never even be surfaced. This was the whole point of the
  // always-on-chest-strap plan's "no new drain on the ring" goal, which the
  // original implementation never actually wired up.
  function wants(s: LiveHrSource): boolean {
    if (ambientIds.has(s.id)) return ambientWanted || workoutWanted
    return workoutWanted && activeSourceId() !== 'chest_strap'
  }

  async function reconcileOnce(): Promise<void> {
    for (const source of sources) {
      const want = wants(source)
      const isStarted = started.has(source.id)
      // Ambient sources thin their persistence outside a workout.
      if (ambientIds.has(source.id)) source.setAmbient?.(!workoutWanted)
      if (want && !isStarted) {
        await source.start()
        const unsub = source.subscribe(sample => {
          // Only surface the highest-precedence connected source's beats.
          if (activeSourceId() !== source.id) return
          current = { ...sample, sourceId: source.id }
          const full: LiveHrSample = { ...sample, sourceId: source.id }
          for (const cb of subscribers) cb(full)
        })
        started.set(source.id, unsub)
      } else if (!want && isStarted) {
        started.get(source.id)!()
        started.delete(source.id)
        try { await source.stop() } catch { /* best effort */ }
        if (current.sourceId === source.id) current = { bpm: null, at: null, sourceId: null }
      }
    }
  }

  // Serialize reconciles so overlapping start/stop/ambient calls can't race into
  // double-starting a source (source.start() is not idempotent on its own).
  let queue: Promise<void> = Promise.resolve()
  function reconcile(): Promise<void> {
    queue = queue.then(reconcileOnce, reconcileOnce)
    return queue
  }

  return {
    activeSourceId,
    getDiagnostics,
    measureNow,
    setForced,
    isRunning: () => workoutWanted,
    getCurrent: () => current,
    subscribe(cb) {
      subscribers.push(cb)
      return () => { subscribers = subscribers.filter(s => s !== cb) }
    },
    async start() {
      if (workoutWanted) return
      workoutWanted = true
      await reconcile()
      if (!workoutReconcileTimer) {
        workoutReconcileTimer = setInterval(() => { void reconcile() }, WORKOUT_RECONCILE_MS)
      }
    },
    async stop() {
      if (!workoutWanted) return
      workoutWanted = false
      if (workoutReconcileTimer) { clearInterval(workoutReconcileTimer); workoutReconcileTimer = null }
      await reconcile()
    },
    async startAmbient() { if (ambientWanted) return; ambientWanted = true; await reconcile() },
    async stopAmbient() { if (!ambientWanted) return; ambientWanted = false; await reconcile() },
    async retryAmbient() {
      if (!ambientWanted && !workoutWanted) return
      // Only reconcile when a wanted ambient source isn't started — a source whose start() threw
      // (BLE off, permission not yet granted) is otherwise stranded, since nothing re-runs
      // reconcile until the next start/stop. Skipping it when everything is already started keeps
      // this tick from firing a setAmbient bridge call every minute for no reason.
      if (sources.some(s => ambientIds.has(s.id) && wants(s) && !started.has(s.id))) {
        await reconcile().catch(() => {})
      }
      for (const s of sources) {
        if (!ambientIds.has(s.id) || !started.has(s.id)) continue
        try { await s.retry?.() } catch { /* best effort — the ring covers */ }
      }
    },
  }
}

// App-wide singleton.
let appManager: LiveHrManager | null = null
export function getLiveHrManager(): LiveHrManager {
  // Registration order = precedence. The chest strap (beat-accurate, motion-robust,
  // worn-gated) wins whenever connected AND worn; otherwise the ring covers. Only
  // the strap runs in ambient (all-day) mode — the ring stays workout-only.
  if (!appManager) appManager = createLiveHrManager([new ChestStrapSource(), new OuraRingSource()])
  return appManager
}
