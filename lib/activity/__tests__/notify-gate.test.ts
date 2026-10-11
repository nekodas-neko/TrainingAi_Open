import { describe, it, expect } from 'vitest'
import { shouldNotifyActivity, isWorkoutInProgress } from '../auto-detection-service'
import { isGuidedWalkActive } from '@/lib/stores/guided-walk-store'
import { isActivityActive } from '@/lib/stores/activity-store'

// Gates the one-off "Activity detected" ping. The save-path quality thresholds
// (detection-thresholds.ts) are unchanged and tested separately; this only
// covers the notification-timing predicate. Thresholds: 200 m AND 90 s.
describe('shouldNotifyActivity', () => {
  it('does not fire on stationary indoor GPS drift (short distance, even after time)', () => {
    // 40 m of jitter over 120 s — clears elapsed but never accumulates distance.
    expect(shouldNotifyActivity({ distanceM: 40, elapsedSec: 120, alreadyNotified: false })).toBe(false)
  })

  it('does not fire before enough distance is covered', () => {
    expect(shouldNotifyActivity({ distanceM: 150, elapsedSec: 200, alreadyNotified: false })).toBe(false)
  })

  it('does not fire before enough time has elapsed', () => {
    // Distance met but a brief burst — hold until it is sustained.
    expect(shouldNotifyActivity({ distanceM: 250, elapsedSec: 60, alreadyNotified: false })).toBe(false)
  })

  it('fires once a genuine walk is sustained (distance and elapsed met)', () => {
    expect(shouldNotifyActivity({ distanceM: 220, elapsedSec: 100, alreadyNotified: false })).toBe(true)
  })

  it('fires exactly at the thresholds (inclusive)', () => {
    expect(shouldNotifyActivity({ distanceM: 200, elapsedSec: 90, alreadyNotified: false })).toBe(true)
  })

  it('does not re-fire once already notified this session', () => {
    expect(shouldNotifyActivity({ distanceM: 500, elapsedSec: 300, alreadyNotified: true })).toBe(false)
  })
})

// A workout in progress suppresses the passive walk/run trigger entirely — a stronger, definite
// signal than any cadence/speed threshold (see auto-detection-service.ts's dispatchGate guard).
describe('isWorkoutInProgress', () => {
  it('is false before a workout has started', () => {
    expect(isWorkoutInProgress('pre')).toBe(false)
  })

  it('is false once a workout is finished', () => {
    expect(isWorkoutInProgress('done')).toBe(false)
  })

  it('is true during warmup', () => {
    expect(isWorkoutInProgress('warmup')).toBe(true)
  })

  it('is true during active sets/rest — the reported false-positive scenario', () => {
    expect(isWorkoutInProgress('active')).toBe(true)
  })

  it('is true reviewing an exercise summary mid-workout', () => {
    expect(isWorkoutInProgress('exercise-summary')).toBe(true)
  })
})

// ── Q-95: dispatchGate's motionTrigger suppression was blind to a guided walk / manual activity ──
// isWorkoutInProgress already suppressed the passive trigger during a lifting workout; a Guided
// Walk and a manually-started "Other Activity" are the identical case (incidental motion during a
// session the app already knows about) but neither store was checked, so auto-detection could
// double-log a session covering the same window. dispatchGate itself isn't exported (module-level
// mutable gate state, real Zustand stores) so this proves the composed condition it now evaluates,
// using the real exported predicates rather than re-implementing the logic.
describe('dispatchGate motionTrigger suppression (workout + guided walk + manual activity)', () => {
  const shouldSuppress = (workoutMode: string, walkMode: string, activityMode: string) =>
    isWorkoutInProgress(workoutMode as never) ||
    isGuidedWalkActive({ mode: walkMode as never }) ||
    isActivityActive({ mode: activityMode as never })

  it('does not suppress when nothing is active (the normal case)', () => {
    expect(shouldSuppress('pre', 'config', 'idle')).toBe(false)
  })

  it('suppresses during an active guided walk — the reported bug', () => {
    expect(shouldSuppress('pre', 'active', 'idle')).toBe(true)
  })

  it('suppresses during an active manual "Other Activity" — the sibling gap found in passing', () => {
    expect(shouldSuppress('pre', 'config', 'active')).toBe(true)
  })

  it('still suppresses during a lifting workout (pre-existing behaviour, unchanged)', () => {
    expect(shouldSuppress('active', 'config', 'idle')).toBe(true)
  })

  it('does not suppress once the guided walk finishes', () => {
    expect(shouldSuppress('pre', 'done', 'idle')).toBe(false)
  })
})

// The ring-confirm notification gate (Q-68, `shouldNotifyRingConfirmedActivity`) is gone with the
// path it guarded: #2471 removed the ring's live trigger, because its windows arrive in hourly
// drains and every one was read as "now". Walks the ring saw are offered from its MET instead.
