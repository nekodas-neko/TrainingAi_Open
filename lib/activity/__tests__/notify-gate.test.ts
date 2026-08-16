import { describe, it, expect } from 'vitest'
import { shouldNotifyActivity, shouldNotifyRingConfirmedActivity, isWorkoutInProgress } from '../auto-detection-service'
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

// ── Q-68: the ring-confirm path had no distance corroboration at all ────────────────────────────
// AD-1's sensor path has run behind shouldNotifyActivity for a while; AD-2's ring-confirm path —
// active whenever the ring is connected, so the common case — fired the moment cadence confirmed.
// The owner saw "Recording your walk or run" in the same minute as a scale weigh-in.
describe('shouldNotifyRingConfirmedActivity', () => {
  const args = (o: Partial<Parameters<typeof shouldNotifyRingConfirmedActivity>[0]>) =>
    shouldNotifyRingConfirmedActivity({
      pointCount: 0, distanceM: 0, elapsedSec: 0, alreadyNotified: false, ...o,
    })

  it('vetoes a confirmation GPS says did not move — the reported false positive', () => {
    // Shuffling around a room: GPS has a fix and it shows almost nothing.
    expect(args({ pointCount: 12, distanceM: 15, elapsedSec: 120 })).toBe(false)
  })

  it('still fires for a real walk', () => {
    expect(args({ pointCount: 40, distanceM: 400, elapsedSec: 300 })).toBe(true)
  })

  it('trusts the ring when GPS has NO fix — the case AD-2 exists for', () => {
    // A genuine indoor walk can have zero GPS points. Requiring distance here would silently break
    // exactly what the ring path was built to do better than GPS. This is the veto/requirement
    // distinction, and getting it backwards is the way this fix could do more harm than the bug.
    expect(args({ pointCount: 0, distanceM: 0, elapsedSec: 0 })).toBe(true)
  })

  it('trusts the ring on a single point — one position is not a distance', () => {
    expect(args({ pointCount: 1, distanceM: 0, elapsedSec: 200 })).toBe(true)
  })

  it('vetoes real distance covered too quickly to be a walk window', () => {
    // Distance alone is not enough: a short burst clears 200 m without being a sustained walk.
    expect(args({ pointCount: 8, distanceM: 400, elapsedSec: 30 })).toBe(false)
  })

  it('holds the one-shot latch, GPS or not', () => {
    expect(args({ alreadyNotified: true, pointCount: 40, distanceM: 400, elapsedSec: 300 })).toBe(false)
    expect(args({ alreadyNotified: true, pointCount: 0 })).toBe(false)
  })
})
