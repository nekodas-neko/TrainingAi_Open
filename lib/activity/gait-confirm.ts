// Sustained-window accumulator for AD-2 ring-cadence walk/run confirmation — see
// docs/superpowers/plans/2026-07-23-ring-cadence-activity-detection.md §2. A single in-band gait
// window isn't enough to confirm a real walk/run — that is exactly the false-positive class this
// plan fixes (a stationary lifting set can produce one stray in-band reading). Oura/Garmin both
// require a sustained cadence signature before confirming. Pure reducer, mirrors motion-gate.ts's
// style so it's unit-testable without a device.

import type { GaitState } from '@trainingai/shared/health/gait-classifier'

export interface GaitWindow {
  state: GaitState
  atMs: number
}

export interface GaitConfirmContext {
  streak: GaitWindow[]
  confirmedThisSession: boolean
}

export interface GaitConfirmResult {
  ctx: GaitConfirmContext
  confirmed: { activityType: 'walk' | 'run'; startMs: number } | null
}

// ~90 s of continuous in-band cadence (3 × the ring's ~30 s gate-window cadence) before
// confirming — long enough that a lifting set or brief hand motion can't produce it, short
// enough to still "perfectly depict the start" of a real walk (start is backdated to the first
// window in the confirming streak, not the confirm instant).
export const CONFIRM_WINDOW_COUNT = 3

// A drain can deliver a burst of windows covering the whole preceding hour in one delivery — those
// arrive "in order" but are not temporally consecutive. Cap the gap between adjacent windows in a
// streak so three windows an hour apart (a real gap, not jitter) can't backdate a walk's start to
// the first one. Generous vs. the ~30 s gate cadence to tolerate normal delivery jitter.
export const MAX_WINDOW_GAP_MS = 2 * 60 * 1000

export function initGaitConfirm(): GaitConfirmContext {
  return { streak: [], confirmedThisSession: false }
}

/** Feed one gait window in order. A non-locomotor ('idle') window resets the streak, and so does a
 *  window arriving more than MAX_WINDOW_GAP_MS after the previous one — the streak must be
 *  CONSECUTIVE in both state and time. Confirms at most once per session (confirmedThisSession latches). */
export function pushGaitWindow(ctx: GaitConfirmContext, window: GaitWindow): GaitConfirmResult {
  if (window.state === 'idle') {
    return { ctx: { streak: [], confirmedThisSession: ctx.confirmedThisSession }, confirmed: null }
  }

  const prev = ctx.streak[ctx.streak.length - 1]
  const gappedTooFar = prev !== undefined && window.atMs - prev.atMs > MAX_WINDOW_GAP_MS
  const streak = gappedTooFar ? [window] : [...ctx.streak, window]
  if (ctx.confirmedThisSession || streak.length < CONFIRM_WINDOW_COUNT) {
    return { ctx: { streak, confirmedThisSession: ctx.confirmedThisSession }, confirmed: null }
  }

  const walkCount = streak.filter(w => w.state === 'walk').length
  const runCount = streak.filter(w => w.state === 'run').length
  const activityType: 'walk' | 'run' = runCount > walkCount ? 'run' : 'walk'

  return {
    ctx: { streak, confirmedThisSession: true },
    confirmed: { activityType, startMs: streak[0].atMs },
  }
}
