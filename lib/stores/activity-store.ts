import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ActivityMode, ActivityDraftSummary } from '@/components/activity/types'
import type { RoutePoint } from '@/lib/activity/route-encoding'
import type { CadenceSummary } from '@trainingai/shared/health/cadence'
import { simplifyRoute, encodeRoute } from '@/lib/activity/route-encoding'
import { debouncedLocalStorage } from '@/lib/stores/debounced-storage'
import {
  haversineDistanceKm,
  computeTotalDistanceKm,
  computeSplits,
  computeBestEfforts,
  computePaceSeries,
  computeElevationChange,
  computeElevationProfile,
  computeAvgPaceSecPerKm,
} from '@/lib/activity/activity-metrics'

interface ActivityState {
  activitySessionId: string
  prescribedRunId: string | null
  activityType: string | null
  activityLabel: string
  activityIcon: string
  isDistanceBased: boolean
  title: string
  mode: ActivityMode
  isPaused: boolean

  startMs: number | null
  endMs: number | null
  pauseStartMs: number | null
  accumulatedPauseMs: number

  rawPoints: RoutePoint[]
  distanceKm: number
  currentPaceSecPerKm: number | null

  draftSummary: ActivityDraftSummary | null
}

interface ActivityActions {
  startActivity: (typeId: string, label: string, icon: string, isDistanceBased: boolean) => void
  linkPrescribedRun: (id: string) => void
  setTitle: (title: string) => void
  begin: () => void
  pause: () => void
  resume: () => void
  appendPoint: (point: RoutePoint) => void
  finish: (cadence?: CadenceSummary | null) => void
  resetSession: () => void
}

export type ActivityStore = ActivityState & ActivityActions

/** Mirrors `isGuidedWalkActive`/`isWorkoutActive` — true whenever a run/activity is
 *  mid-flight, so nav-away guards (bottom nav, hardware back) all agree on one check. */
export function isActivityActive(state: { mode: ActivityMode }): boolean {
  return state.mode === 'active'
}

const ROUTE_SIMPLIFY_TOLERANCE_M = 5

// A mode:'active' session older than this on rehydrate is abandoned, not resumable — see the
// onRehydrateStorage comment below.
const MAX_ACTIVE_RECOVERY_MS = 12 * 60 * 60 * 1000

const INITIAL_STATE: ActivityState = {
  activitySessionId: '',
  prescribedRunId: null,
  activityType: null,
  activityLabel: '',
  activityIcon: '',
  isDistanceBased: false,
  title: '',
  mode: 'pre',
  isPaused: false,
  startMs: null,
  endMs: null,
  pauseStartMs: null,
  accumulatedPauseMs: 0,
  rawPoints: [],
  distanceKm: 0,
  currentPaceSecPerKm: null,
  draftSummary: null,
}

const PERSIST_DEBOUNCE_MS = 2000

export const useActivityStore = create<ActivityStore>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      startActivity: (typeId, label, icon, isDistanceBased) => set({
        ...INITIAL_STATE,
        activitySessionId: crypto.randomUUID(),
        activityType: typeId,
        activityLabel: label,
        activityIcon: icon,
        isDistanceBased,
        title: label,
        mode: 'pre',
      }),

      linkPrescribedRun: (id) => set({ prescribedRunId: id }),

      setTitle: (title) => set({ title }),

      begin: () => set({ mode: 'active', startMs: Date.now() }),

      pause: () => set({ isPaused: true, pauseStartMs: Date.now() }),

      resume: () => set((s) => ({
        isPaused: false,
        pauseStartMs: null,
        accumulatedPauseMs: s.accumulatedPauseMs + (s.pauseStartMs ? Date.now() - s.pauseStartMs : 0),
      })),

      appendPoint: (point) => set((s) => {
        const rawPoints = [...s.rawPoints, point]
        const prevPoint = s.rawPoints[s.rawPoints.length - 1]
        const distanceKm = prevPoint ? s.distanceKm + haversineDistanceKm(prevPoint, point) : s.distanceKm
        const activeMs = s.startMs ? Date.now() - s.startMs - s.accumulatedPauseMs : 0
        return {
          rawPoints,
          distanceKm,
          currentPaceSecPerKm: computeAvgPaceSecPerKm(distanceKm, activeMs / 1000) ?? null,
        }
      }),

      finish: (cadence) => {
        const s = get()
        const endMs = Date.now()
        const activeMs = (s.startMs ? endMs - s.startMs : 0) - s.accumulatedPauseMs
        const durationMin = Math.round((activeMs / 60000) * 10) / 10

        let draftSummary: ActivityDraftSummary = { durationMin }

        if (s.isDistanceBased && s.rawPoints.length >= 2) {
          const distanceKm = computeTotalDistanceKm(s.rawPoints)
          const simplified = simplifyRoute(s.rawPoints, ROUTE_SIMPLIFY_TOLERANCE_M)
          const { gainM, lossM } = computeElevationChange(s.rawPoints)
          // Denominator must come from the same stream as the distance numerator (GPS fix time),
          // not the phone wall clock — splits/paceSeries/bestEfforts already derive from
          // s.rawPoints, and mixing clocks means avgPaceSecPerKm can never reconcile with them.
          const gpsElapsedSec = (s.rawPoints[s.rawPoints.length - 1].t - s.rawPoints[0].t) / 1000
          draftSummary = {
            ...draftSummary,
            distanceKm: Math.round(distanceKm * 100) / 100,
            routePolyline: encodeRoute(simplified),
            splits: computeSplits(s.rawPoints),
            bestEfforts: computeBestEfforts(s.rawPoints),
            paceSeries: computePaceSeries(s.rawPoints),
            avgPaceSecPerKm: computeAvgPaceSecPerKm(distanceKm, gpsElapsedSec) ?? undefined,
            elevationGainM: gainM,
            elevationLossM: lossM,
            elevationProfile: computeElevationProfile(s.rawPoints),
          }
        }

        // Cadence is measured, not derived from the route, so it applies to every
        // foot-based activity - including the treadmill, which has no GPS at all.
        if (cadence?.avgSpm != null) {
          draftSummary = {
            ...draftSummary,
            cadenceSpm: cadence.avgSpm,
            cadenceSeries: cadence.series,
            cadenceSource: cadence.source ?? undefined,
            // Integrated at summarise time from strap readings only (Q-230) — carried here so the
            // done screen can save it without re-deriving from the binned series, which has lost
            // the per-reading source by then.
            cadenceStepsEstimate: cadence.stepsEstimate ?? undefined,
          }
        }

        set({ mode: 'done', endMs, draftSummary })
      },

      resetSession: () => set({ ...INITIAL_STATE }),
    }),
    {
      name: 'ta_activity_state',
      storage: createJSONStorage(() => debouncedLocalStorage(PERSIST_DEBOUNCE_MS)),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        // An in-progress (unsaved) activity is recoverable after a kill — keep
        // startMs/rawPoints/etc. intact. But mode:'done' means the summary was
        // already shown once; restoring it verbatim days later (with a stale
        // draftSummary) is the "phantom done screen" bug, so it's the one mode
        // that must not survive a reload.
        if (state.mode === 'done') {
          state.mode = 'pre'
          state.draftSummary = null
        }
        // mode:'active' has no staleness bound otherwise: an abandoned session (app killed,
        // never resumed) leaves startMs stamped from whenever `begin()` ran, and the elapsed
        // timer runs away for as long as the store sits on disk (owner-observed: a "Run" review
        // screen showing 25,723.2 minutes elapsed for a 0.51 km route — an 18-day-old session).
        // Mirrors guided-walk-store.ts / auto-detection-store.ts, which already bound theirs.
        if (state.mode === 'active' && state.startMs != null && Date.now() - state.startMs > MAX_ACTIVE_RECOVERY_MS) {
          state.mode = 'pre'
          state.startMs = null
          state.rawPoints = []
        }
      },
    }
  )
)
