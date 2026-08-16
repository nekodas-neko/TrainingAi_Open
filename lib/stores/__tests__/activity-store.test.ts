// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useActivityStore } from '../activity-store'

describe('activity-store rehydration resets stale mode:"done" state (transient-state policy)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('resets mode:"done" to "pre" and clears draftSummary on rehydrate — the phantom done-screen bug', async () => {
    localStorage.setItem('ta_activity_state', JSON.stringify({
      state: {
        activitySessionId: 'a1', activityType: 'walk', activityLabel: 'Walk', activityIcon: '',
        isDistanceBased: true, title: 'Walk', mode: 'done', isPaused: false,
        startMs: 1000, endMs: 2000, pauseStartMs: null, accumulatedPauseMs: 0,
        rawPoints: [], distanceKm: 1, currentPaceSecPerKm: null,
        draftSummary: { durationMin: 5 },
      },
      version: 0,
    }))
    await useActivityStore.persist.rehydrate()
    const state = useActivityStore.getState()
    expect(state.mode).toBe('pre')
    expect(state.draftSummary).toBeNull()
    // Everything else survives — this isn't a full reset, only the stale-done fix.
    expect(state.startMs).toBe(1000)
    expect(state.distanceKm).toBe(1)
  })

  it('leaves a recent mode:"active" session untouched on rehydrate — in-progress is recoverable after a kill', async () => {
    const recentStartMs = Date.now() - 5 * 60 * 1000 // 5 minutes ago
    localStorage.setItem('ta_activity_state', JSON.stringify({
      state: {
        activitySessionId: 'a2', activityType: 'run', activityLabel: 'Run', activityIcon: '',
        isDistanceBased: true, title: 'Run', mode: 'active', isPaused: false,
        startMs: recentStartMs, endMs: null, pauseStartMs: null, accumulatedPauseMs: 0,
        rawPoints: [], distanceKm: 0.5, currentPaceSecPerKm: 300,
        draftSummary: null,
      },
      version: 0,
    }))
    await useActivityStore.persist.rehydrate()
    const state = useActivityStore.getState()
    expect(state.mode).toBe('active')
    expect(state.startMs).toBe(recentStartMs)
  })

  it('abandons a stale mode:"active" session on rehydrate instead of letting the timer run away', async () => {
    // The owner-reported bug: a session started 18 days ago (startMs: 5000, effectively 1970)
    // survived rehydration forever, showing a 25,723.2-minute elapsed time on a 0.51 km route.
    localStorage.setItem('ta_activity_state', JSON.stringify({
      state: {
        activitySessionId: 'a3', activityType: 'run', activityLabel: 'Run', activityIcon: '',
        isDistanceBased: true, title: 'Run', mode: 'active', isPaused: false,
        startMs: 5000, endMs: null, pauseStartMs: null, accumulatedPauseMs: 0,
        rawPoints: [{ lat: 0, lng: 0, t: 5000 }], distanceKm: 0.5, currentPaceSecPerKm: 300,
        draftSummary: null,
      },
      version: 0,
    }))
    await useActivityStore.persist.rehydrate()
    const state = useActivityStore.getState()
    expect(state.mode).toBe('pre')
    expect(state.startMs).toBeNull()
    expect(state.rawPoints).toEqual([])
  })
})
