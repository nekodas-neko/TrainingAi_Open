'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { recordDetectionEvent, newDetectionId } from '@/lib/activity/detection-events'

/**
 * Walks waiting on the "detected" card.
 *
 * #3844 (owner, 16 Nov): the phone's live GPS and motion detector is gone. Walks now come from the
 * day's movement data (`lib/activity/ring-walks.ts`, which asks `/api/activity-detection/walks`) and
 * from the workouts the source records itself, which reach the energy budget and the day timeline
 * without this store. What is left here is the offer: what is pending, and what was answered.
 */
export interface PendingSession {
  id: string
  startMs: number
  endMs: number
  routePolyline: string   // encoded
  distanceKm: number
  durationMin: number
  activityType: 'walk' | 'run'
  /**
   * `'ring'` (#2471): a walk found after the fact in the day's MET, with no route and no distance
   * (`lib/activity/ring-walks.ts`). `'phone'`: the live GPS detector removed in #3844, with a route.
   * Nothing writes `'phone'` now, but **this store is persisted**, so a device can still hold one
   * offered before that change; it stays reviewable until answered.
   *
   * Q-231 retired the `'oura'` source with the Cloud sync that wrote it, and `onRehydrateStorage`
   * drops any such session still persisted rather than letting it render with no route.
   */
  source: 'phone' | 'ring'
  /** #2478. The detection this session came from, for the funnel events its save or dismissal
   *  sends. Absent on a session finalized before that shipped, which then sends none. */
  detectionId?: string
}

interface AutoDetectionState {
  pendingSessions: PendingSession[]
  /** #2471. Start times of ring walks the user already answered (saved or dismissed), so the next
   *  sync does not offer them again. Kept for RING_WALK_MEMORY_MS, longer than the server's window. */
  answeredRingWalks: number[]
}

/** A ring walk the server offers (`GET /api/activity-detection/walks`). */
export interface RingWalkOffer {
  startMs: number
  endMs: number
  durationMin: number
}

/** How long an answered ring walk is remembered: the server offers today's walks only. */
const RING_WALK_MEMORY_MS = 3 * 24 * 60 * 60 * 1000

interface AutoDetectionActions {
  dismissSession(id: string): void
  removeSession(id: string): void
  /** #2471. Offer the ring walks the server found, minus any already answered or already pending. */
  offerRingWalks(walks: readonly RingWalkOffer[]): void
}

/** The answered-walks patch for a session leaving the card: only ring walks are remembered. */
function rememberAnswered(s: { answeredRingWalks: number[] }, session: PendingSession | undefined): { answeredRingWalks?: number[] } {
  if (session?.source !== 'ring') return {}
  const cutoff = Date.now() - RING_WALK_MEMORY_MS
  return { answeredRingWalks: [...s.answeredRingWalks.filter(t => t > cutoff), session.startMs] }
}

export const useAutoDetectionStore = create<AutoDetectionState & AutoDetectionActions>()(
  persist(
    (set, get) => ({
      pendingSessions: [],
      answeredRingWalks: [],

      // The confirm card's Dismiss / Dismiss all. The review sheet's own Dismiss goes through
      // removeSession and reports itself (exercise-review-sheet.tsx).
      dismissSession: (id) => {
        const dismissed = get().pendingSessions.find(p => p.id === id)
        if (dismissed) {
          recordDetectionEvent(dismissed.detectionId, 'dismissed', 'user_card', {
            sessionStartAt: dismissed.startMs, activityType: dismissed.activityType,
            distanceM: dismissed.source === 'ring' ? null : dismissed.distanceKm * 1000, elapsedSec: (dismissed.endMs - dismissed.startMs) / 1000,
          })
        }
        set(s => ({ pendingSessions: s.pendingSessions.filter(p => p.id !== id), ...rememberAnswered(s, dismissed) }))
      },

      // The review sheet's Save and Dismiss. A saved ring walk becomes a logged activity, which the
      // server already excludes; remembering it as well covers the sync before that push lands.
      removeSession: (id) => set(s => ({
        pendingSessions: s.pendingSessions.filter(p => p.id !== id),
        ...rememberAnswered(s, s.pendingSessions.find(p => p.id === id)),
      })),

      offerRingWalks: (walks) => {
        const { pendingSessions, answeredRingWalks } = get()
        const fresh = walks.filter(w =>
          !answeredRingWalks.includes(w.startMs)
          // One already on offer (or a phone walk persisted from before #3844) is the same walk.
          && !pendingSessions.some(p => p.startMs < w.endMs && p.endMs > w.startMs))
        if (fresh.length === 0) return
        const added: PendingSession[] = fresh.map(w => {
          const detectionId = newDetectionId()
          recordDetectionEvent(detectionId, 'candidate', 'ring_met', { sessionStartAt: w.startMs, activityType: 'walk' })
          recordDetectionEvent(detectionId, 'offered', 'ring_met', {
            sessionStartAt: w.startMs, activityType: 'walk', elapsedSec: (w.endMs - w.startMs) / 1000,
          })
          return {
            id: crypto.randomUUID(), startMs: w.startMs, endMs: w.endMs, routePolyline: '', distanceKm: 0,
            durationMin: w.durationMin, activityType: 'walk', source: 'ring',
            ...(detectionId ? { detectionId } : {}),
          }
        })
        set({ pendingSessions: [...pendingSessions, ...added] })
      },

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
      // #3844: only the offer is persisted. A store written before then also holds the removed
      // detector's in-flight GPS session; `merge` drops it on the way in and the next write leaves
      // it out.
      partialize: (s) => ({
        pendingSessions: s.pendingSessions,
        answeredRingWalks: s.answeredRingWalks,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AutoDetectionState>
        return {
          ...current,
          ...(Array.isArray(p.pendingSessions) ? { pendingSessions: p.pendingSessions } : {}),
          ...(Array.isArray(p.answeredRingWalks) ? { answeredRingWalks: p.answeredRingWalks } : {}),
        }
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return
        // Q-231: a session persisted before the Oura Cloud ingest was removed carries `source:
        // 'oura'` and an empty `routePolyline`. Nothing can mark it reviewed server-side any more, so
        // it would sit in the card forever offering a route-less review. Drop it on the way in.
        state.pendingSessions = state.pendingSessions.filter(
          p => (p as { source?: string }).source !== 'oura',
        )
        // Absent on a store persisted before #2471.
        state.answeredRingWalks = (state.answeredRingWalks ?? []).filter(t => t > Date.now() - RING_WALK_MEMORY_MS)
      },
    }
  )
)
