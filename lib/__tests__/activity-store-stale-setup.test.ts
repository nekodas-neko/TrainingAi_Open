import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { reconcileRehydratedActivity, clearActivitySetup } from '@/lib/stores/activity-store'
import type { ActivityState } from '@/lib/stores/activity-store'

/**
 * BF-108 — a finished walk's name no longer arms the Start screen.
 *
 * The owner: *"after closing it - it still opens with the activity naming screen"*, with a Start
 * button titled from a walk they had already done.
 *
 * **The rehydrate hook demoted the session to `pre` and left the setup behind.** Both of its branches
 * reset `mode` — a `done` session, and an `active` one past the 12-hour recovery bound — and neither
 * cleared `activityType` or `title`, so `activity-screen.tsx` rendered `PreActivityScreen`, pre-armed,
 * instead of falling through to `SelectActivityTypeScreen`.
 *
 * **The entry blamed the completion path and that was wrong.** `done-activity-screen.tsx` calls
 * `resetSession()` on both save paths and `pre-activity-screen.tsx` calls it on Back, so a saved or
 * cancelled activity already leaves clean state. What survives is a session **abandoned** before
 * saving — reached `done` and killed, or left `active` past the bound.
 *
 * These drive the real `reconcileRehydratedActivity`, which was lifted out of `onRehydrateStorage`
 * for exactly that reason: `persist` does not expose the hook, so the alternative was a mirror of it,
 * and a mirror that drifts is a test of itself.
 */

const HOURS = 60 * 60 * 1000

const SETUP = {
  activityType: 'walk',
  activityLabel: 'Walk',
  activityIcon: 'footprints',
  isDistanceBased: true,
  title: 'Walk Home From Train',
  prescribedRunId: 'run-1',
}

function state(over: Partial<ActivityState>): ActivityState {
  return {
    activitySessionId: 's1', prescribedRunId: null, activityType: null, activityLabel: '',
    activityIcon: '', isDistanceBased: false, title: '', mode: 'pre', isPaused: false,
    startMs: null, endMs: null, pauseStartMs: null, accumulatedPauseMs: 0, rawPoints: [],
    distanceKm: 0, currentPaceSecPerKm: null, draftSummary: null,
    ...over,
  } as ActivityState
}

describe('a session demoted to pre loses its setup', () => {
  it('after a done session that was never saved', () => {
    const s = state({ ...SETUP, mode: 'done', draftSummary: { durationMin: 30 } as never })
    reconcileRehydratedActivity(s)
    expect(s.mode).toBe('pre')
    expect(s.draftSummary).toBeNull()
    // A null type is precisely what routes activity-screen to SelectActivityTypeScreen.
    expect(s.activityType).toBeNull()
    expect(s.title).toBe('')
    expect(s.prescribedRunId, 'a stale prescribed run would re-arm the wrong session too').toBeNull()
  })

  it('after an active session past the 12-hour recovery bound', () => {
    const s = state({ ...SETUP, mode: 'active', startMs: Date.now() - 18 * 24 * HOURS, rawPoints: [{} as never] })
    reconcileRehydratedActivity(s)
    expect(s.mode).toBe('pre')
    expect(s.startMs).toBeNull()
    expect(s.rawPoints).toEqual([])
    expect(s.activityType).toBeNull()
    expect(s.title).toBe('')
  })
})

describe('what must NOT be touched', () => {
  it('a live in-flight session keeps everything — this is Q-450', () => {
    // An `active` session inside the bound must keep its type, so activity-screen returns it to its
    // own screen rather than a picker that would drop the recording. A careless fix breaks this one.
    const s = state({ ...SETUP, mode: 'active', startMs: Date.now() - 60_000, rawPoints: [{} as never] })
    reconcileRehydratedActivity(s)
    expect(s.mode).toBe('active')
    expect(s.activityType).toBe('walk')
    expect(s.title).toBe('Walk Home From Train')
    expect(s.rawPoints).toHaveLength(1)
  })

  it('an active session exactly at the bound is still live', () => {
    // The comparison is `>`, so the boundary resumes rather than being thrown away. Pinned because
    // an off-by-one here silently discards a recording.
    const s = state({ ...SETUP, mode: 'active', startMs: Date.now() - 12 * HOURS })
    reconcileRehydratedActivity(s)
    expect(s.mode).toBe('active')
  })

  it('a clean pre session is left as it is', () => {
    const s = state({ mode: 'pre' })
    reconcileRehydratedActivity(s)
    expect(s.mode).toBe('pre')
    expect(s.activityType).toBeNull()
  })
})

describe('clearActivitySetup', () => {
  it('clears every field a Pre screen would arm itself from', () => {
    const s = state(SETUP)
    clearActivitySetup(s)
    expect(s).toMatchObject({
      activityType: null, activityLabel: '', activityIcon: '',
      isDistanceBased: false, title: '', prescribedRunId: null,
    })
  })

  it('leaves the recording alone — it is a setup reset, not a session reset', () => {
    // If this also cleared rawPoints/startMs it could not be called from the `done` branch without
    // destroying evidence the summary may still want.
    const s = state({ ...SETUP, startMs: 123, rawPoints: [{} as never], distanceKm: 2.5 })
    clearActivitySetup(s)
    expect(s.startMs).toBe(123)
    expect(s.rawPoints).toHaveLength(1)
    expect(s.distanceKm).toBe(2.5)
  })
})

describe('the walk no longer ends on a Start button', () => {
  it('Done leaves for a screen that shows the walk, not one that begins another', () => {
    const src = readFileSync(path.join(path.resolve(__dirname, '..', '..'), 'components/guided-walk/walk-summary.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(src).toMatch(/onDone\(\); router\.push\('\/health'\)/)
    expect(src, 'the prefetch must follow the destination').toMatch(/router\.prefetch\('\/health'\)/)
    expect(src, '/activity is the screen for STARTING one').not.toMatch(/router\.(push|prefetch)\('\/activity'\)/)
  })
})
