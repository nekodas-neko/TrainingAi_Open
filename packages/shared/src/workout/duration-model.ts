// Single source of truth for session-duration estimation ("One Formula, One Place").
// Consumers: lib/ai-periodization/time-budget.ts (budget enforcement),
// lib/ai-periodization/prompt.ts (formula text shown to the AI),
// app/api/generate-program + app/api/builder-chat (program planning).
//
// Constants are deliberately generous (worst case): overestimating duration
// under-fills a session rather than overrunning the user's time budget. Once
// enough history accrues they are superseded per-lifter by measured medians:
// lib/workout/time-audit.ts's buildMeasuredTimeBudget learns transition + warmup
// times and lib/ai-periodization/signals.ts substitutes them into the plan (the
// constants remain the below-threshold fallback).

export const SECONDS_PER_REP = 4
export const SET_SETUP_SEC = 10

// Warmup overhead as a fraction of the configured session budget (owner-set): it scales
// with the session (a 30-min session doesn't need a 10-min warmup), so working time is the
// remaining 85% — e.g. a 60-min budget buys ~51 min of working time after a ~9-min warmup.
// There is deliberately NO separate finish-early buffer (removed 2026-07-12, owner call):
// the margin comes for free because the plan is estimated on conservative rest/set times —
// during the baseline period rest is generously constant, and once measured per-exercise
// history exists the AI plans on the real (faster) numbers — so on-time execution naturally
// lands under budget without reserving idle minutes up front.
export const WARMUP_FRACTION = 0.15

// Bounds on a *measured* warmup allowance (lib/workout/time-audit.ts feeds a learned
// median once enough sessions exist). Floor keeps a plausible minimum even for a lifter
// who barely warms up on record; ceiling aligns with MAX_PLAUSIBLE_WARMUP_SEC (900s) so
// the two halves of the model agree on what counts as an implausibly long warmup.
export const MIN_WARMUP_MIN = 4
export const MAX_WARMUP_MIN = 15

// Ceiling on the measured warmup carve-out when today's budget is SHORTER than the session's
// own configured length — see warmupBudgetMin. Set above WARMUP_FRACTION on purpose: warmup
// doesn't shrink linearly with the working portion (walking to the gym, joint prep and ramp
// sets cost what they cost), so a squeezed session is allowed to spend a larger *share* on
// warmup than a standard one — just not an unbounded one. The value also makes the two clamps
// meet exactly at the shortest legal budget: 0.20 × MIN_PRESET_BUDGET_MIN (20) = MIN_WARMUP_MIN
// (4), so the floor and this ceiling can never invert for any budget budgetForPreset can emit.
export const WARMUP_CEILING_FRACTION = 0.2

// Warmup minutes carved out of the session budget. With a measured median (learned from
// the lifter's real warmups) it uses that, clamped to [MIN, MAX]; otherwise it falls back
// to the flat fraction of the configured budget.
//
// `standardBudgetMin` is the session's OWN configured length, passed only when today's budget
// may differ from it (a 'short'/'long' DurationPreset). The measured median is learned almost
// entirely from sessions run at that standard length, so it is ground truth *there* and is
// used as-is — including for a session genuinely configured at 30 min, where a 9-min warmup
// really is 30% of the session. It stops being ground truth when the same absolute number is
// subtracted from a budget that was shortened for today: that charged the owner's 30-min
// "Quick" Push the full 9 min learned at 60, leaving 21 working minutes (30% lost to warmup
// vs the 15% the model intends) and forcing the trimmer to drop 3 of 5 exercises. Only that
// case — today's budget below the session's own — gets the proportional ceiling.
export function warmupBudgetMin(
  totalBudgetMin: number,
  measuredWarmupMin?: number | null,
  standardBudgetMin?: number | null,
): number {
  if (measuredWarmupMin != null && measuredWarmupMin > 0) {
    const measured = Math.min(MAX_WARMUP_MIN, Math.max(MIN_WARMUP_MIN, Math.round(measuredWarmupMin)))
    if (standardBudgetMin != null && totalBudgetMin < standardBudgetMin) {
      const ceiling = Math.max(MIN_WARMUP_MIN, Math.round(totalBudgetMin * WARMUP_CEILING_FRACTION))
      return Math.min(measured, ceiling)
    }
    return measured
  }
  return Math.round(totalBudgetMin * WARMUP_FRACTION)
}

// Minutes of actual working time (sets + rest + transitions) a session budget buys.
// A measured warmup median shrinks the warmup carve-out to the lifter's real number, so
// the time they save warming up faster reappears here as room for more working sets.
// Absent a measured value the flat-fraction default is preserved exactly (unchanged
// rounding), so existing plans are untouched until enough history accrues.
export function workingBudgetMin(
  totalBudgetMin: number,
  measuredWarmupMin?: number | null,
  standardBudgetMin?: number | null,
): number {
  if (measuredWarmupMin != null && measuredWarmupMin > 0) {
    return Math.max(15, totalBudgetMin - warmupBudgetMin(totalBudgetMin, measuredWarmupMin, standardBudgetMin))
  }
  return Math.max(15, Math.round(totalBudgetMin * (1 - WARMUP_FRACTION)))
}

// A per-day override of the session's configured time budget: "I've got 30 minutes before
// work" / "it's Saturday, I've got two hours". Deliberately NOT stored on the program —
// it's a choice about today, so it lives only on the prescription it produced. 'standard'
// means the session's own timeBudgetMinutes, whatever the user configured it to.
export type DurationPreset = 'short' | 'standard' | 'long'

// Short/long are RELATIVE to whatever the session is configured for (owner call 2026-07-29:
// "30 mins +/- the routine's chosen amount"), not fixed 30/90 clocks. For the current 60-min
// sessions the numbers are identical either way — but a 45-min session's "short" is 15 min of
// squeeze, not a 30-min *increase*, which is what an absolute floor would have quietly done.
export const DURATION_PRESET_DELTA_MIN = 30

// Absolute floor on a shortened session. Below this the warmup carve-out and two-set role
// floors leave no room for a real session, so shortening further just produces a plan that
// cannot fit its own budget.
export const MIN_PRESET_BUDGET_MIN = 20

/**
 * Seconds of warm-up to show the lifter, for a session of `sessionBudgetMin` at `preset`.
 *
 * The on-screen countdown used to be a flat 600 s regardless of session length, while this same
 * model was already scaling the *planning* budget correctly — so a 30-minute Quick session trimmed
 * its exercise list to a ~5-minute warm-up and then displayed a 10-minute timer (Q-212). One
 * function so the number the lifter watches and the number the plan was built against cannot
 * disagree again.
 *
 * Returns null when the budget is not known yet, so the caller shows its fallback rather than a
 * confidently wrong figure computed from a placeholder.
 */
export function warmupGoalSecFor(
  sessionBudgetMin: number | undefined,
  preset: DurationPreset | undefined,
  measuredWarmupMin?: number | null,
): number | null {
  if (sessionBudgetMin == null || !Number.isFinite(sessionBudgetMin) || sessionBudgetMin <= 0) return null
  const todaysBudget = budgetForPreset(sessionBudgetMin, preset)
  return warmupBudgetMin(todaysBudget, measuredWarmupMin, sessionBudgetMin) * 60
}

export function budgetForPreset(sessionBudgetMin: number, preset: DurationPreset | undefined): number {
  if (preset == null || preset === 'standard') return sessionBudgetMin
  if (preset === 'long') return sessionBudgetMin + DURATION_PRESET_DELTA_MIN
  return Math.max(MIN_PRESET_BUDGET_MIN, sessionBudgetMin - DURATION_PRESET_DELTA_MIN)
}

// Per-exercise transition overhead: walking over, adjusting the station, loading the bar.
export const TRANSITION_SEC_BARBELL = 240
export const TRANSITION_SEC_STANDARD = 120 // machine, dumbbell, cable, kettlebell
export const TRANSITION_SEC_BODYWEIGHT = 60
export const TRANSITION_SEC_DEFAULT = TRANSITION_SEC_BARBELL // unknown equipment: assume worst case

// equipment lists the *options* an exercise can be performed with, so the
// slowest option governs the estimate.
export function transitionSecForEquipment(equipment: string[] | undefined): number {
  if (!equipment || equipment.length === 0) return TRANSITION_SEC_DEFAULT
  if (equipment.includes('barbell')) return TRANSITION_SEC_BARBELL
  if (equipment.every(e => e === 'bodyweight')) return TRANSITION_SEC_BODYWEIGHT
  return TRANSITION_SEC_STANDARD
}

// Per-stage duration for the on-screen warm-up ramp-up timer (prep/activate/potentiate,
// active-workout-screen.tsx) — splits the same equipment-aware transition assumption
// evenly across however many ramp stages are shown. Keeping this here (not inline in
// the component) means TRANSITION_SEC_* stays the single source of truth for both the
// planning estimate AND the on-screen countdown the lifter actually watches.
export function warmupRampSectionSec(equipment: string[] | undefined, sectionCount: number): number {
  if (sectionCount <= 0) return 40
  return transitionSecForEquipment(equipment) / sectionCount
}

export function setWorkSec(reps: number): number {
  return SET_SETUP_SEC + reps * SECONDS_PER_REP
}

// Set work with a measured per-exercise tempo when one exists (lib/workout/time-profile.ts);
// the setup constant stays — the measured slope is derived net of it.
export function effectiveSetWorkSec(reps: number, measuredSecPerRep?: number | null): number {
  return SET_SETUP_SEC + reps * (measuredSecPerRep ?? SECONDS_PER_REP)
}

export interface DurationExercise {
  sets: number
  reps: number
  restSec: number
  transitionSec: number
  // Measured overrides from lib/workout/time-profile.ts — null/absent falls back
  // to the constant model (SECONDS_PER_REP / the planned restSec above).
  measuredSecPerRep?: number | null
  measuredRestSec?: number | null
}

// Rest is charged for EVERY set, not `sets - 1`. The old form assumed the inter-exercise
// transition absorbed the last set's rest; production says they are separate clocks. On the
// 2026-07-28 Push session: 11.1 min of set work + 26.0 min of per-set rest (all 14 sets) +
// 13.2 min of inter-exercise gaps = 50.3 min against a measured 52-min working window — the
// three sum to the window, so `rest_time_sec` and `inter_exercise_rest_sec` do not overlap.
// Dropping one rest per exercise cost ~7-8 min on a 5-exercise session, which is why stored
// estimates read 35-49 min while real working windows ran 41-65 min.
export function estimateExerciseDurationSec(ex: DurationExercise): number {
  return ex.sets * effectiveSetWorkSec(ex.reps, ex.measuredSecPerRep)
    + ex.sets * (ex.measuredRestSec ?? ex.restSec)
    + ex.transitionSec
}

export function estimateSessionDurationSec(exercises: DurationExercise[]): number {
  return exercises.reduce((total, ex) => total + estimateExerciseDurationSec(ex), 0)
}

export function estimateSessionDurationMin(exercises: DurationExercise[]): number {
  return Math.round(estimateSessionDurationSec(exercises) / 60)
}

// Work + rest seconds for a progression-style set shape. No transition overhead —
// callers add transitionSecForEquipment (or a blended planning assumption).
export function styleWorkSec(sets: Array<{ reps: number; restSec: number }>): number {
  return sets.reduce((total, set) => total + setWorkSec(set.reps) + set.restSec, 0)
}
