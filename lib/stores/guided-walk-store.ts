'use client'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { DEFAULT_WALK_CONFIG, buildIntervalPlan, type WalkConfig } from '@/lib/walk/interval-plan'
import type { RoutePoint } from '@/lib/activity/route-encoding'
import { haversineDistanceKm, computeAvgPaceSecPerKm } from '@/lib/activity/activity-metrics'
import { windowedSpeedKmh } from '@/lib/walk/walk-pacer'
import { debouncedLocalStorage } from '@/lib/stores/debounced-storage'
import { addPacerTick, type PacerBand, type PacerSegmentTally, type PacerSignal } from '@trainingai/shared/health/pacer-adherence'

export type WalkMode = 'config' | 'active' | 'done'

/** Mirrors `isWorkoutActive` — true whenever a walk is mid-flight, so the places that must not
 *  double-log it (auto-detection) agree on one check. */
export function isGuidedWalkActive(state: { mode: WalkMode }): boolean {
  return state.mode === 'active'
}

/**
 * BF-191 — below this, exiting a walk offers to discard it instead of saving it.
 *
 * The owner asked for "a mix of min floor duration + confirm on exit". `MIN_SESSION_SEC` (120s,
 * `time-audit.ts`) is the repo's precedent for this shape but is a WORKOUT floor; two minutes of
 * walking is a real walk, so this is its own number rather than a reused one.
 *
 * Two places read it and they must agree: the Exit dialog, which offers a save only above it, and
 * `WalkActive`'s `endWalk`, which refuses to record a walk below it.
 */
export const MIN_WALK_SEC = 60

const PERSIST_DEBOUNCE_MS = 2000

interface GuidedWalkState {
  mode: WalkMode
  config: WalkConfig
  // The user's own saved "Custom" preset — distinct from `config` (the live, currently-applied
  // values) so nudging a stepper away from Long/Short doesn't get silently discarded the next
  // time Long/Short is picked and Custom is swiped back to (Q-99).
  customConfig: WalkConfig | null
  startedAtMs: number | null   // wall-clock start; the timer resyncs from this
  /**
   * DV-19 ③ — this walk's identity, minted at `start` and persisted with it. The summary's
   * activity row is written under it, so the walk owns its row rather than the mount that saved it.
   */
  walkId: string | null
  /**
   * DV-19 ③ — the `walkId` whose summary save has been claimed. `WalkSummary` saved on every MOUNT
   * (its guard was a ref), and the summary remounts whenever the route is re-entered while the walk
   * is still `'done'` — Back off the summary leaves it there. The second mount has none of the
   * walk's samples or elapsed time, so on the device its outbox replay (last-write-wins on the
   * server's `(user, date, start_time)` key) overwrote the real walk with a 0-minute one.
   */
  savedWalkId: string | null
  rawPoints: RoutePoint[]
  distanceKm: number
  /** Cumulative: total distance over total elapsed. The summary wants this; the pacer must not
   *  (LA-52) — see `recentSpeedKmh`. */
  currentPaceSecPerKm: number | null
  /** Speed over the last `SPEED_WINDOW_SEC`, which is what the walker is doing *now*. */
  recentSpeedKmh: number | null
  /**
   * Issue 2242 (LA-48): per segment, the seconds the walker was shown each pacer band, by signal.
   * Lives here rather than in component state so a walk that is killed mid-way keeps its counts
   * (this store is persisted) and a remount cannot lose or double them. Keyed by segment index.
   */
  pacerTallies: Record<number, PacerSegmentTally>
  /** The last whole second a tick was counted for. A second tick in the same second is ignored, so
   *  two mounts of the bar (or a rehydrate replay) cannot double count. */
  pacerLastTickSec: number | null
  /** Counts one second of what the pacer showed. No-op unless the walk is active. */
  recordPacerTick: (segmentIndex: number, signal: PacerSignal, band: PacerBand, atMs: number) => void
  setConfig: (c: Partial<WalkConfig>) => void
  setCustomConfig: (c: WalkConfig) => void
  start: (nowMs: number) => void
  appendPoint: (point: RoutePoint) => void
  finish: () => void
  reset: () => void
  /** Claims this walk's one summary save. Returns the id to write the row under, or null when the
   *  walk is not finished or its save is already claimed — the caller then writes nothing. */
  claimWalkSave: () => string | null
  /** Hands the claim back after a save that wrote nothing anywhere, so a later mount can retry. */
  releaseWalkSave: (walkId: string) => void
}

function newWalkId(): string {
  return crypto.randomUUID()
}

export const useGuidedWalkStore = create<GuidedWalkState>()(
  persist(
    (set, get) => ({
      mode: 'config',
      config: DEFAULT_WALK_CONFIG,
      customConfig: null,
      startedAtMs: null,
      walkId: null,
      savedWalkId: null,
      rawPoints: [],
      distanceKm: 0,
      currentPaceSecPerKm: null,
      recentSpeedKmh: null,
      pacerTallies: {},
      pacerLastTickSec: null,
      recordPacerTick: (segmentIndex, signal, band, atMs) => set((s) => {
        if (s.mode !== 'active') return {}
        const sec = Math.floor(atMs / 1000)
        if (s.pacerLastTickSec != null && sec <= s.pacerLastTickSec) return {}
        return {
          pacerLastTickSec: sec,
          pacerTallies: { ...s.pacerTallies, [segmentIndex]: addPacerTick(s.pacerTallies[segmentIndex], signal, band) },
        }
      }),
      setConfig: (c) => set(s => ({ config: { ...s.config, ...c } })),
      setCustomConfig: (c) => set({ customConfig: c }),
      start: (nowMs) => set({ mode: 'active', startedAtMs: nowMs, walkId: newWalkId(), savedWalkId: null, rawPoints: [], distanceKm: 0, currentPaceSecPerKm: null, recentSpeedKmh: null, pacerTallies: {}, pacerLastTickSec: null }),
      appendPoint: (point) => set((s) => {
        const prevPoint = s.rawPoints[s.rawPoints.length - 1]
        const distanceKm = prevPoint ? s.distanceKm + haversineDistanceKm(prevPoint, point) : s.distanceKm
        const elapsedSec = s.startedAtMs != null ? (point.t - s.startedAtMs) / 1000 : 0
        const rawPoints = [...s.rawPoints, point]
        return {
          rawPoints,
          distanceKm,
          currentPaceSecPerKm: computeAvgPaceSecPerKm(distanceKm, elapsedSec) ?? null,
          recentSpeedKmh: windowedSpeedKmh(rawPoints),
        }
      }),
      finish: () => set({ mode: 'done' }),
      reset: () => set({ mode: 'config', startedAtMs: null, walkId: null, savedWalkId: null, rawPoints: [], distanceKm: 0, currentPaceSecPerKm: null, recentSpeedKmh: null, pacerTallies: {}, pacerLastTickSec: null }),
      claimWalkSave: () => {
        const s = get()
        if (s.mode !== 'done' || s.startedAtMs == null) return null
        // A walk persisted before `walkId` existed rehydrates without one; it gets one here, once.
        const walkId = s.walkId ?? newWalkId()
        if (s.savedWalkId === walkId) return null
        set({ walkId, savedWalkId: walkId })
        return walkId
      },
      releaseWalkSave: (walkId) => set(s => (s.savedWalkId === walkId ? { savedWalkId: null } : {})),
    }),
    {
      name: 'ta_guided_walk_v1',
      storage: createJSONStorage(() => debouncedLocalStorage(PERSIST_DEBOUNCE_MS)),
      onRehydrateStorage: () => (state) => {
        // Transient state must not survive rehydration: never auto-resume a stale active
        // session (e.g. from a previous day). If the stored start is older than the planned
        // duration + a grace margin, reset to config. A 'done' mode also resets — the
        // summary's in-memory samples are gone after a reload, so there's nothing to show.
        if (!state) return
        if (state.mode === 'done') {
          state.mode = 'config'; state.startedAtMs = null; state.walkId = null; state.savedWalkId = null
          state.pacerTallies = {}; state.pacerLastTickSec = null
          return
        }
        if (state.mode !== 'active' || state.startedAtMs == null) return
        const totalMs = buildIntervalPlan(state.config).totalSec * 1000
        if (Date.now() - state.startedAtMs > totalMs + 60_000) {
          state.mode = 'config'
          state.startedAtMs = null
          state.walkId = null
          state.savedWalkId = null
          state.pacerTallies = {}
          state.pacerLastTickSec = null
        }
      },
    },
  ),
)
