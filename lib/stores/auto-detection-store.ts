'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { RoutePoint } from '@/lib/activity/route-encoding'
import { computeTotalDistanceKm, haversineDistanceKm } from '@/lib/activity/activity-metrics'
import { encodeRoute, simplifyRoute } from '@/lib/activity/route-encoding'
import { MIN_DISTANCE_M, MIN_AVG_SPEED_MS, MIN_DURATION_SEC } from '@/lib/activity/detection-thresholds'

export interface PendingSession {
  id: string
  startMs: number
  endMs: number
  routePolyline: string   // encoded; empty string if source === 'oura'
  distanceKm: number
  durationMin: number
  activityType: 'walk' | 'run'
  source: 'phone' | 'oura'
  ouraWorkoutId?: string
}

export interface DetectionDiag {
  gateState: string
  gpsSinceMs: number | null
  lastPointMs: number | null
  trigger: 'ring' | 'sensor'
}

interface AutoDetectionState {
  isDetecting: boolean
  sessionStartMs: number | null
  sessionPoints: RoutePoint[]
  pendingSessions: PendingSession[]
  detectionError: string | null
  detectionDiag: DetectionDiag | null
  // AD-2: the ring-cadence confirm's classified type, threaded through to endSession so it wins
  // over the GPS-avg-speed guess below. Null when the session started via the ring-disconnected
  // GPS-speed fallback (AD-1), which still derives the type from avg speed as before.
  pendingActivityType: 'walk' | 'run' | null
}

interface AutoDetectionActions {
  setDetecting(v: boolean): void
  startSession(ms: number, activityType?: 'walk' | 'run'): void
  addPoint(point: RoutePoint): void
  endSession(): void
  /** Throw an in-flight session away without finalizing it. Distinct from `endSession`, which
   *  turns the session into a `pendingSessions` entry — i.e. into a confirm sheet. Used when the
   *  app learns the motion belonged to a session it already knows about (a Guided Walk, a manual
   *  activity, a lifting workout), where the right outcome is that the detection never happened. */
  discardSession(): void
  dismissSession(id: string): void
  removeSession(id: string): void
  addOuraSession(session: Omit<PendingSession, 'id'>): void
  setDetectionError(message: string | null): void
  setDetectionDiag(diag: DetectionDiag | null): void
}

// avg speed >= 2.08 m/s == run (8 min/km threshold)
const RUN_SPEED_THRESHOLD_MS = 2.08
// Discard sessions shorter than the shared minimum duration (Balanced: 7 min)
const MIN_DURATION_MS = MIN_DURATION_SEC * 1000
// Discard sessions with avg speed above 7.5 m/s (27 km/h) — these are driving, not walking/running
const MAX_SPEED_MS = 7.5
// Trains/buses still average under MAX_SPEED_MS due to station stops, but their GPS segments
// between stops show 15-25 m/s. We use the 80th-percentile segment speed to detect this:
// city-walk GPS jitter produces occasional high-speed spikes but can't lift the 80th percentile,
// whereas a train running at speed between stops will push the 80th percentile well above
// the threshold even after accounting for the slow station-dwell segments.
const MOTORISED_P80_SPEED_MS = 8.0  // 28.8 km/h — no walk/run sustains this at the 80th pct

function segmentSpeedP80(points: import('@/lib/activity/route-encoding').RoutePoint[]): number {
  if (points.length < 2) return 0
  const speeds: number[] = []
  for (let i = 1; i < points.length; i++) {
    const dtSec = (points[i].t - points[i - 1].t) / 1000
    if (dtSec <= 0) continue
    speeds.push((haversineDistanceKm(points[i - 1], points[i]) * 1000) / dtSec)
  }
  if (!speeds.length) return 0
  speeds.sort((a, b) => a - b)
  return speeds[Math.floor(speeds.length * 0.80)]
}

export const useAutoDetectionStore = create<AutoDetectionState & AutoDetectionActions>()(
  persist(
    (set, get) => ({
      isDetecting: false,
      sessionStartMs: null,
      sessionPoints: [],
      pendingSessions: [],
      detectionError: null,
      detectionDiag: null,
      pendingActivityType: null,

      setDetecting: (v) => set({ isDetecting: v }),
      setDetectionError: (message) => set({ detectionError: message }),
      setDetectionDiag: (diag) => set({ detectionDiag: diag }),

      startSession: (ms, activityType) => set({ sessionStartMs: ms, sessionPoints: [], pendingActivityType: activityType ?? null }),

      addPoint: (point) => set(s => ({ sessionPoints: [...s.sessionPoints, point] })),

      discardSession: () => set({ sessionStartMs: null, sessionPoints: [], pendingActivityType: null }),

      endSession: () => {
        const { sessionStartMs, sessionPoints, pendingActivityType } = get()
        if (!sessionStartMs || sessionPoints.length < 2) {
          set({ sessionStartMs: null, sessionPoints: [], pendingActivityType: null })
          return
        }
        const endMs = sessionPoints[sessionPoints.length - 1].t
        if (endMs - sessionStartMs < MIN_DURATION_MS) {
          set({ sessionStartMs: null, sessionPoints: [], pendingActivityType: null })
          return
        }

        const simplified = simplifyRoute(sessionPoints, 5)
        const distanceKm = computeTotalDistanceKm(sessionPoints)
        const durationMin = (endMs - sessionStartMs) / 60000
        const avgSpeedMs = distanceKm > 0
          ? (distanceKm * 1000) / ((endMs - sessionStartMs) / 1000)
          : 0

        // Lower-bound quality gates (Balanced) — the phone path previously had only upper
        // bounds, so a slow short shuffle around the house qualified as a walk. Discard
        // anything under the shared minimum distance or pace.
        if (distanceKm * 1000 < MIN_DISTANCE_M || avgSpeedMs < MIN_AVG_SPEED_MS) {
          set({ sessionStartMs: null, sessionPoints: [], pendingActivityType: null })
          return
        }

        // Above MAX_SPEED_MS this is driving/cycling, not a walk or run — discard
        if (avgSpeedMs > MAX_SPEED_MS) {
          set({ sessionStartMs: null, sessionPoints: [], pendingActivityType: null })
          return
        }
        // Trains/buses average under MAX_SPEED_MS due to station stops, but their 80th-percentile
        // GPS segment speed is still well above walking pace. GPS jitter spikes can't lift the
        // 80th percentile on a genuine walk, so this filter is robust to city multipath noise.
        if (segmentSpeedP80(sessionPoints) > MOTORISED_P80_SPEED_MS) {
          set({ sessionStartMs: null, sessionPoints: [], pendingActivityType: null })
          return
        }

        // AD-2: the ring-cadence confirm's classified type wins when present (real signal, not a
        // speed guess). GPS avg-speed stays the type source only for the ring-disconnected
        // fallback (AD-1), where no cadence classification exists.
        const activityType: 'walk' | 'run' = pendingActivityType ?? (avgSpeedMs >= RUN_SPEED_THRESHOLD_MS ? 'run' : 'walk')

        const session: PendingSession = {
          id: crypto.randomUUID(),
          startMs: sessionStartMs,
          endMs,
          routePolyline: encodeRoute(simplified),
          distanceKm,
          durationMin,
          activityType,
          source: 'phone',
        }

        set(s => ({
          pendingSessions: [...s.pendingSessions, session],
          sessionStartMs: null,
          sessionPoints: [],
          pendingActivityType: null,
        }))
      },

      dismissSession: (id) => set(s => ({
        pendingSessions: s.pendingSessions.filter(p => p.id !== id),
      })),

      removeSession: (id) => set(s => ({
        pendingSessions: s.pendingSessions.filter(p => p.id !== id),
      })),

      addOuraSession: (session) => set(s => ({
        pendingSessions: [
          ...s.pendingSessions,
          { ...session, id: crypto.randomUUID() },
        ],
      })),
    }),
    {
      name: 'auto-detection-store',
      storage: createJSONStorage(() => {
        if (typeof localStorage === 'undefined') return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        }
        return localStorage
      }),
      // detectionError is a transient runtime signal from the current watcher —
      // never worth surviving a reload as stale state ahead of the next real check.
      partialize: (s) => ({
        isDetecting: s.isDetecting,
        sessionStartMs: s.sessionStartMs,
        sessionPoints: s.sessionPoints,
        pendingSessions: s.pendingSessions,
        pendingActivityType: s.pendingActivityType,
      }),
      // isDetecting reflects whether a live background watcher is currently
      // running — that watcher can't possibly still be running after a fresh
      // app launch, so a persisted `true` is always stale.
      onRehydrateStorage: () => (state) => {
        if (!state) return
        state.isDetecting = false
        // A persisted in-flight session whose last point is stale means the
        // app died mid/after-walk. Finalize it — endSession's own quality
        // gates decide whether it becomes a pending session — instead of
        // letting it linger and contaminate the next walk. A FRESH session
        // (reload mid-walk, e.g. a deploy) is left in place so tracking can
        // resume seamlessly.
        const pts = state.sessionPoints
        const lastT = pts.length ? pts[pts.length - 1].t : 0
        if (state.sessionStartMs !== null && Date.now() - lastT > 3 * 60 * 1000) {
          queueMicrotask(() => useAutoDetectionStore.getState().endSession())
        }
      },
    }
  )
)
