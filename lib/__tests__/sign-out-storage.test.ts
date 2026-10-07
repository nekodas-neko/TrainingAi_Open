// @vitest-environment jsdom
// #2453 — signing out clears the account's browser storage and keeps the phone's.
//
// Two people, one phone: A signs out with a workout in progress, B signs in. Before this, the `ta_`
// prefix sweep in `clearAllCache()` was the only browser-storage wipe, and on the web build A's
// detected activity (`auto-detection-store`, not spelled `ta_`) rendered on B's Home as
// "1 ready · Activity to review" — measured on `pnpm dev`, see PR. These tests pin both halves:
// what goes, what stays, and the order that stops a mounted store writing A's state straight back.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useWorkoutStore } from '@/lib/stores/workout-store'
import { useActivityStore } from '@/lib/stores/activity-store'
import { useAutoDetectionStore } from '@/lib/stores/auto-detection-store'
import { useGuidedWalkStore } from '@/lib/stores/guided-walk-store'
import {
  ACCOUNT_STORAGE, DEVICE_STORAGE, clearAccountStorage, resetAccountStores,
} from '@/lib/sign-out-storage'
import { DEVICE_LOCAL_PREFERENCES } from '@trainingai/shared/user/preferences'

const A_WORKOUT = {
  state: {
    workoutSessionId: 'a-session', sessionType: 'Push', workoutStartMs: Date.now() - 20 * 60_000,
    workoutEndMs: null, mode: 'pre', sessionLog: [{ name: 'Bench Press', setWeights: [100], reps: [8] }],
    todayLogged: { Push: ['Bench Press'] },
  },
  version: 0,
}
const A_DETECTED = {
  state: { pendingSessions: [{ id: 'a-walk', startMs: 1, endMs: 2, activityType: 'walking', routePolyline: 'xyz' }] },
  version: 0,
}

/** What A leaves on the phone: account data in both storages, and the phone's own settings. */
async function seedPersonA(): Promise<void> {
  localStorage.setItem('ta_workout_state', JSON.stringify(A_WORKOUT))
  localStorage.setItem('auto-detection-store', JSON.stringify(A_DETECTED))
  localStorage.setItem('chat_history_coach', '[{"role":"user","content":"private","ts":1}]')
  localStorage.setItem('detection-events-outbox', '[{"id":"e"}]')
  localStorage.setItem('ta-oura-ble-pending-accel-chunks', '[{"c":1}]')
  localStorage.setItem('ta_prefs_unsynced', '["foodRegion"]')
  localStorage.setItem('ta_steps_goal', '12345')
  localStorage.setItem('ta_cache:weekly-stats', '{"data":{},"expiresAt":0}')
  localStorage.setItem('ta_weight_unit_v1:ex-1', 'lb')
  localStorage.setItem('some_future_key_nobody_classified', 'x')
  sessionStorage.setItem('ta_recommendation_v1', '{"date":"2026-10-07","data":{}}')
  sessionStorage.setItem('ta_coach_pending:call-1', '{}')
  // The phone's.
  localStorage.setItem('theme', 'dark')
  localStorage.setItem('ta_brand_theme', 'ocean')
  localStorage.setItem('ta_background_settings', '{"state":{"enabled":true},"version":0}')
  localStorage.setItem('ta_paired_hr_strap_v1', '{"id":"AA:BB"}')
  localStorage.setItem('ta_paired_scale_v1', '{"id":"CC:DD"}')
  localStorage.setItem('ta_paired_colmi_ring_v1', '{"id":"EE:FF"}')
  localStorage.setItem('ta_ring_auto_capture', '1')
  localStorage.setItem('ta_ring_continuous_capture', '1')
  localStorage.setItem('ta_strap_battery_v1', '{"percent":80}')
  sessionStorage.setItem('ta-history-entry-depth', '3')
  await useWorkoutStore.persist.rehydrate()
  await useAutoDetectionStore.persist.rehydrate()
}

const keys = (s: Storage) => Array.from({ length: s.length }, (_, i) => s.key(i)!).sort()

describe('clearAccountStorage (#2453)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    resetAccountStores()
  })

  it('A signs out mid-workout: every account key goes, every device key stays', async () => {
    await seedPersonA()
    expect(useWorkoutStore.getState().sessionLog).toHaveLength(1)
    expect(useAutoDetectionStore.getState().pendingSessions).toHaveLength(1)

    clearAccountStorage()

    expect(keys(localStorage)).toEqual([
      'ta_background_settings', 'ta_brand_theme', 'ta_paired_colmi_ring_v1', 'ta_paired_hr_strap_v1',
      'ta_paired_scale_v1', 'ta_ring_auto_capture', 'ta_ring_continuous_capture', 'ta_strap_battery_v1',
      'theme',
    ])
    expect(keys(sessionStorage)).toEqual(['ta-history-entry-depth'])
  })

  it('B signs in on the same page: the stores in memory hold nothing of A', async () => {
    await seedPersonA()
    clearAccountStorage()

    const w = useWorkoutStore.getState()
    expect(w.workoutStartMs).toBeNull()
    expect(w.sessionLog).toEqual([])
    expect(w.todayLogged).toEqual({})
    expect(useAutoDetectionStore.getState().pendingSessions).toEqual([])
  })

  it('a mounted screen writing after the clear cannot put A\'s workout back', async () => {
    await seedPersonA()
    clearAccountStorage()

    // A timer tick or a stray handler on a screen that has not unmounted yet.
    useWorkoutStore.getState().setTimestamps({ restStartMs: 123 })

    const persisted = JSON.parse(localStorage.getItem('ta_workout_state')!).state
    expect(persisted.sessionLog).toEqual([])
    expect(persisted.workoutStartMs).toBeNull()
    expect(persisted.workoutSessionId).not.toBe('a-session')
  })

  it('the order matters: removing the key without the reset lets the next set() restore A', async () => {
    // Pins why resetAccountStores runs first. This is the naive version, done by hand.
    await seedPersonA()
    localStorage.removeItem('ta_workout_state')
    useWorkoutStore.getState().setTimestamps({ restStartMs: 123 })
    expect(JSON.parse(localStorage.getItem('ta_workout_state')!).state.sessionLog).toHaveLength(1)
  })

  it('a debounced write still pending at sign-out does not land A\'s activity afterwards', async () => {
    vi.useFakeTimers()
    try {
      useActivityStore.getState().startActivity('run', 'A run', 'icon', true)
      useGuidedWalkStore.getState().start(Date.now())
      // Both writes are now waiting on the 2 s debounce.
      clearAccountStorage()
      vi.advanceTimersByTime(5_000)
      expect(localStorage.getItem('ta_activity_state')).toBeNull()
      expect(localStorage.getItem('ta_guided_walk_v1')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('the two lists do not overlap, and every device-local preference is kept', () => {
    for (const key of Object.keys(DEVICE_STORAGE)) {
      expect(ACCOUNT_STORAGE, key).not.toHaveProperty(key)
    }
    for (const key of Object.keys(DEVICE_LOCAL_PREFERENCES)) {
      expect(DEVICE_STORAGE, key).toHaveProperty(key)
    }
  })

  it('keeps nothing that would act for the previous account', () => {
    // Upload queues POST under whoever is signed in, and the unsynced-preference list is re-sent to
    // the server on hydrate: kept, each would write A's data into B's account.
    for (const key of [
      'ta_workout_state', 'auto-detection-store', 'ta_prefs_unsynced', 'detection-events-outbox',
      'ta-cadence-captures', 'ta-oura-ble-pending-live-steps', 'ta-oura-ble-pending-live-steps-auto',
      'ta-oura-ble-pending-accel-chunks', 'ta_hc_last_sync',
    ]) {
      expect(DEVICE_STORAGE, key).not.toHaveProperty(key)
    }
  })
})
