'use client'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { DEFAULT_WALK_CONFIG, buildIntervalPlan, type WalkConfig } from '@/lib/walk/interval-plan'
import type { RoutePoint } from '@/lib/activity/route-encoding'
import { haversineDistanceKm, computeAvgPaceSecPerKm } from '@/lib/activity/activity-metrics'
import { windowedSpeedKmh } from '@/lib/walk/walk-pacer'
import { debouncedLocalStorage } from '@/lib/stores/debounced-storage'

export type WalkMode = 'config' | 'active' | 'done'

/** Mirrors `isWorkoutActive` — true whenever a walk is mid-flight, so nav-away guards
 *  (bottom nav, hardware back, the in-screen End-walk button) all agree on one check. */
export function isGuidedWalkActive(state: { mode: WalkMode }): boolean {
  return state.mode === 'active'
}

/**
 * BF-191 — below this, ending a walk offers to discard it instead of saving it.
 *
 * The owner asked for "a mix of min floor duration + confirm on exit". `MIN_SESSION_SEC` (120s,
 * `time-audit.ts`) is the repo's precedent for this shape but is a WORKOUT floor; two minutes of
 * walking is a real walk, so this is its own number rather than a reused one.
 *
 * It lives HERE rather than beside the walk screen because LB-141 gave the tab bar a say in the
 * same decision, and importing `walk-active.tsx` into the shell would pull the whole walk screen —
 * cadence tracker, map, dynamic chunks — into every route's bundle for one integer.
 */
export const MIN_WALK_SEC = 60

/**
 * How long the walk has been running, from the wall clock.
 *
 * Extracted because THREE places now compare it against `MIN_WALK_SEC` and they must agree: the
 * walk screen's own End dialog, and the two exits outside that tree (the back gesture and the tab
 * bar), which decide from this whether to offer a save at all. A second copy of the expression is
 * a dialog that offers to save a walk the screen then discards.
 */
export function walkElapsedSec(startedAtMs: number | null, nowMs = Date.now()): number {
  if (startedAtMs == null) return 0
  return Math.floor((nowMs - startedAtMs) / 1000)
}

const PERSIST_DEBOUNCE_MS = 2000

interface GuidedWalkState {
  mode: WalkMode
  config: WalkConfig
  // The user's own saved "Custom" preset — distinct from `config` (the live, currently-applied
  // values) so nudging a stepper away from Long/Short doesn't get silently discarded the next
  // time Long/Short is picked and Custom is swiped back to (Q-99).
  customConfig: WalkConfig | null
  startedAtMs: number | null   // wall-clock start; the timer resyncs from this
  rawPoints: RoutePoint[]
  distanceKm: number
  /** Cumulative: total distance over total elapsed. The summary wants this; the pacer must not
   *  (LA-52) — see `recentSpeedKmh`. */
  currentPaceSecPerKm: number | null
  /** Speed over the last `SPEED_WINDOW_SEC`, which is what the walker is doing *now*. */
  recentSpeedKmh: number | null
  /**
   * Set when an exit OUTSIDE the walk screen asks the active walk to end and save itself (LB-141).
   *
   * It is a request rather than the finish itself because the walk's HR samples and cadence live in
   * `WalkActive`'s refs, and the save runs on `WalkSummary`'s mount — neither is reachable from the
   * tab bar or the back handler. Flipping `mode` to `'done'` from out there would read as a save and
   * write nothing.
   */
  finishRequested: boolean
  setConfig: (c: Partial<WalkConfig>) => void
  setCustomConfig: (c: WalkConfig) => void
  start: (nowMs: number) => void
  appendPoint: (point: RoutePoint) => void
  finish: () => void
  requestFinish: () => void
  clearFinishRequest: () => void
  reset: () => void
}

export const useGuidedWalkStore = create<GuidedWalkState>()(
  persist(
    (set) => ({
      mode: 'config',
      config: DEFAULT_WALK_CONFIG,
      customConfig: null,
      startedAtMs: null,
      rawPoints: [],
      distanceKm: 0,
      currentPaceSecPerKm: null,
      recentSpeedKmh: null,
      finishRequested: false,
      setConfig: (c) => set(s => ({ config: { ...s.config, ...c } })),
      setCustomConfig: (c) => set({ customConfig: c }),
      start: (nowMs) => set({ mode: 'active', startedAtMs: nowMs, rawPoints: [], distanceKm: 0, currentPaceSecPerKm: null, recentSpeedKmh: null, finishRequested: false }),
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
      finish: () => set({ mode: 'done', finishRequested: false }),
      requestFinish: () => set({ finishRequested: true }),
      clearFinishRequest: () => set({ finishRequested: false }),
      reset: () => set({ mode: 'config', startedAtMs: null, rawPoints: [], distanceKm: 0, currentPaceSecPerKm: null, recentSpeedKmh: null, finishRequested: false }),
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
        // Nothing is `partialize`d out of this store, so the request flag persists like everything
        // else. A stored `true` would finish the walk the moment the app came back.
        state.finishRequested = false
        if (state.mode === 'done') { state.mode = 'config'; state.startedAtMs = null; return }
        if (state.mode !== 'active' || state.startedAtMs == null) return
        const totalMs = buildIntervalPlan(state.config).totalSec * 1000
        if (Date.now() - state.startedAtMs > totalMs + 60_000) {
          state.mode = 'config'
          state.startedAtMs = null
        }
      },
    },
  ),
)
