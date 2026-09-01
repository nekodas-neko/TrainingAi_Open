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
  setConfig: (c: Partial<WalkConfig>) => void
  setCustomConfig: (c: WalkConfig) => void
  start: (nowMs: number) => void
  appendPoint: (point: RoutePoint) => void
  finish: () => void
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
      setConfig: (c) => set(s => ({ config: { ...s.config, ...c } })),
      setCustomConfig: (c) => set({ customConfig: c }),
      start: (nowMs) => set({ mode: 'active', startedAtMs: nowMs, rawPoints: [], distanceKm: 0, currentPaceSecPerKm: null, recentSpeedKmh: null }),
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
      reset: () => set({ mode: 'config', startedAtMs: null, rawPoints: [], distanceKm: 0, currentPaceSecPerKm: null, recentSpeedKmh: null }),
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
