import { roundTo } from '@trainingai/shared/stats'
import { goalRange } from '@trainingai/shared/ai-periodization/goal-ranges'
import type { EffortSource, EffortVsPlan } from '@trainingai/shared/workout/effort-vs-plan'

// RPE-based autoregulation.
//
// A back-off requires a HIGH RPE plus a second corroborating signal — but that second signal
// is now EITHER a regressing 1RM OR a missed rep target:
//   • RPE ran HIGH and 1RM went DOWN → back off: cut load 5–10%, sized by how badly reps were
//     missed (rep-completion). Failing by ~a rep → 5%; failing badly → the 10% ceiling.
//   • RPE ran HIGH and you FELL SHORT of the prescribed reps → back off the same way, even if
//     the 1RM is flat/rising. Not completing the set at a high RPE means the load was too heavy
//     to finish with clean reps — a signal in its own right. Reps are held; only the load drops.
//   • RPE ran LOW  and 1RM held/rose (and reps met) → push: RPE-modulated double progression.
//     Bump target reps up the goal band; at the band ceiling an accessory earns a set while a
//     compound lets the already-earned 1RM carry the load. The engine never fabricates a 1RM —
//     it raises the DEMAND and lets the lifter earn the jump.
// High RPE with every rep completed on a non-regressing lift → no action (the healthy +1/AMRAP
// hard session). RPE on target (inside the dead-band) → no action regardless of reps/1RM.

export const RPE_DEAD_BAND = 1.5 // trigger threshold: |avg actual − expected RPE|
const BACKOFF_MIN_PCT = 5
export const BACKOFF_MAX_PCT = 10
const COMPLETION_FLOOR = 0.7 // ≤ this (missed badly) → max cut
const COMPLETION_CEIL = 0.95 // ≥ this (missed by ~a rep) → min cut
export const PCT_HARD_FLOOR = 40 // never cut a working set below this %1RM in one step

// #4061 (owner, 23 Nov: "We will gauge from that instead of rpe"): the lifter's tapped answer to
// "How did it feel?" on a lift's latest log stands in for that lift's rated-RPE delta, through the
// same rule below, not a second one. The sizes are the smallest deltas that trip each branch:
//   • Harder = +RPE_DEAD_BAND. It reaches the back-off threshold, so with a miss or a falling 1RM it
//     cuts exactly as a high rated RPE does (the cut is sized by the reps, never by the delta); alone
//     it is the healthy hard session, so no cut and no bump.
//   • Easier = −RPE_DEAD_BAND. It reaches the push threshold but not the −2 that earns a double bump,
//     so with reps met and a 1RM not falling it adds one rep (or a set at the band top), as a rated
//     RPE 1.5 below plan does. One tap is a coarser report than several rated sets, so it earns the
//     smaller step.
//   • As expected, and every untouched (`default`) answer, is no signal.
export const TAPPED_HARDER_RPE_DELTA = RPE_DEAD_BAND
export const TAPPED_EASIER_RPE_DELTA = -RPE_DEAD_BAND

/** The answer on a lift's latest log, as stored (`exercise_logs.effort_vs_plan` / `effort_source`). */
export interface LatestEffortAnswer { vsPlan: number | null; source: string | null }

/**
 * The lift's effort signal for `computeRpeAdjustment`. A tapped answer on the latest log wins over
 * the rated-RPE delta (As expected included, which is no signal); anything else (an untouched
 * default, no answer) leaves the rated delta exactly as it was, null included.
 */
export function effortRpeDelta(ratedDelta: number | null, latest: LatestEffortAnswer | null | undefined): number | null {
  const tapped = tappedEffort(latest)
  if (tapped === undefined) return ratedDelta
  return tapped === 1 ? TAPPED_HARDER_RPE_DELTA : tapped === -1 ? TAPPED_EASIER_RPE_DELTA : null
}

/** The tapped answer, or undefined when the latest log carries none (untouched, absent, unreadable). */
export function tappedEffort(latest: LatestEffortAnswer | null | undefined): EffortVsPlan | undefined {
  if (latest?.source !== ('tapped' satisfies EffortSource)) return undefined
  return latest.vsPlan === -1 || latest.vsPlan === 0 || latest.vsPlan === 1 ? latest.vsPlan : undefined
}

export interface AutoregSignal {
  role: string
  rpeDelta: number | null // avg (actual RPE − expected RPE) across the exercise's recent sets
  rm1Trend: 'up' | 'flat' | 'down'
  repCompletionRate: number | null // actual reps ÷ prescribed reps last session (null = unknown)
  /** #4061: set when `rpeDelta` came from the lifter's tapped answer, so the note says what they said. */
  effortFromAnswer?: true
  /** #4079: which way the tap went (-1 easier, 1 harder), so a tap the rule did not act on can be said
   *  back to the lifter. As expected is never passed: it is no signal and earns no note. */
  effortAnswer?: -1 | 1
}

export interface AutoregContext {
  phase: string
  currentReps: number
  band: { repMin: number; repMax: number }
}

export interface AutoregAdjustment {
  pctMultiplier: number // 1 = unchanged; < 1 = back-off load cut
  repDelta: number // target-rep change (double progression climb)
  setDelta: number // earned extra set (subject to the time budget downstream)
  note: string | null
}

const NONE: AutoregAdjustment = { pctMultiplier: 1, repDelta: 0, setDelta: 0, note: null }

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function computeRpeAdjustment(sig: AutoregSignal, ctx: AutoregContext): AutoregAdjustment {
  if (sig.rpeDelta == null) return NONE
  if (ctx.phase === 'deload' || ctx.phase === 'baseline') return NONE

  // ⬇️ Back-off: RPE ran high AND (the lift is regressing OR you fell short of the prescribed
  // reps). A miss at high RPE means the load was too heavy to finish the set with clean reps —
  // actioned on its own, even when the 1RM is flat/rising. Reps are held; only the load is cut,
  // 5–10% sized by how far short the reps fell (missed by ~a rep → 5%; badly → the 10% ceiling).
  const missedReps = sig.repCompletionRate != null && sig.repCompletionRate < COMPLETION_CEIL
  if (sig.rpeDelta >= RPE_DEAD_BAND && (sig.rm1Trend === 'down' || missedReps)) {
    const completion = sig.repCompletionRate ?? COMPLETION_CEIL // unknown → mildest cut
    const t = clamp((COMPLETION_CEIL - completion) / (COMPLETION_CEIL - COMPLETION_FLOOR), 0, 1)
    const cutPct = BACKOFF_MIN_PCT + (BACKOFF_MAX_PCT - BACKOFF_MIN_PCT) * t
    const why = sig.effortFromAnswer ? 'it felt harder than expected' : 'RPE ran high'
    return {
      pctMultiplier: 1 - cutPct / 100,
      repDelta: 0,
      setDelta: 0,
      note: missedReps
        ? `−${roundTo(cutPct, 1)}% load — ${why} and you fell short of the prescribed reps`
        : `−${roundTo(cutPct, 1)}% load — ${why} while your 1RM slipped`,
    }
  }

  // ⬆️ Push: RPE ran low AND the lift is holding/rising AND the reps were met.
  // Q-299: null must read the same way on both paths. `missedReps` above already treats "no
  // completion data" as "not proven missed" (false) rather than blocking the back-off outright —
  // so this must equally treat it as "not proven met" (false) rather than assuming success. The
  // old `?? 1` read missing data as a completed set, which is optimistic on exactly the path that
  // adds load and had no matching pessimism on the path that cuts it.
  const metReps = sig.repCompletionRate != null && sig.repCompletionRate >= 1
  if (sig.rpeDelta <= -RPE_DEAD_BAND && sig.rm1Trend !== 'down' && metReps) {
    if (ctx.phase === 'realisation') return NONE // no rep pushes in a low-rep peak block
    const bump = sig.rpeDelta <= -2 ? 2 : 1
    if (ctx.currentReps < ctx.band.repMax) {
      const repDelta = Math.min(bump, ctx.band.repMax - ctx.currentReps)
      return {
        pctMultiplier: 1,
        repDelta,
        setDelta: 0,
        note: `+${repDelta} target rep${repDelta > 1 ? 's' : ''} — that felt easy, earning the next jump`,
      }
    }
    // At the band ceiling: accessories add a set; compounds let the earned 1RM carry the load.
    if (sig.role === 'accessory') {
      return {
        pctMultiplier: 1,
        repDelta: 0,
        setDelta: 1,
        note: "+1 set — you're at the top of the rep range and it still felt easy",
      }
    }
    return NONE
  }

  return NONE
}

/**
 * #4079: one plain sentence for a lift whose tapped Harder or Easier the rule read and changed
 * nothing for, so the lifter is not left wondering whether the tap counted. Written here from the same
 * stored values the rule reads, never by the model, and only called when `computeRpeAdjustment`
 * returned no note (a tap that did change the plan keeps that rule's own note). It changes no number.
 * Null for no tap, and for an answer that is not Harder or Easier.
 *
 * Every sentence says what the ANSWER did, never what the plan does: the load is set after this rule
 * (accessory floats, secondary floors and caps, the anchor cap, a check-in hold, the zone clamp, the
 * Coach's restate and the budget re-fit), so the plan can still differ from last session's.
 * "Reps" are the logged ones: a skipped planned set leaves no row (rep-completion.ts), so a completion
 * of 1 means the logged sets were on target, not that every planned set was done. A null completion
 * means no comparison was possible (nothing logged, or the log did not run the prescription).
 *
 * The reasons follow the rule's own order: a phase that takes no adjustment, then (Harder) the rule's
 * two triggers not being met, or (Easier) its three conditions, then the top of the band.
 * Baseline is not worded: the generator returns 400 for an incomplete baseline before this runs, so
 * the phase cannot reach here, and an untested sentence for it was removed.
 */
export function unactedEffortNote(sig: AutoregSignal, ctx: AutoregContext): string | null {
  if (sig.effortFromAnswer !== true) return null
  const said = sig.effortAnswer === 1 ? 'harder' : sig.effortAnswer === -1 ? 'easier' : null
  if (said == null) return null
  const lead = `You said it felt ${said}.`
  const butLead = `You said it felt ${said},`
  const tail = "so your answer doesn't change the plan."

  // Deload weeks take no adjustment at all (the rule returns before reading the answer).
  if (ctx.phase === 'deload') return `${lead} This is a deload week, ${tail}`
  if (ctx.phase === 'baseline') return null

  const rate = sig.repCompletionRate
  if (sig.effortAnswer === 1) {
    // Reached only when the cut did not fire: reps not proven short and the 1RM not falling.
    if (rate == null) return `${lead} The app could not compare your reps with the plan, ${tail}`
    if (rate >= 1) return `${lead} Your logged reps were on target, ${tail}`
    return `${lead} Your logged reps were just short of your target reps, ${tail}`
  }

  // Easier. A push needs every logged rep met and a 1RM that is not falling.
  if (rate == null) return `${lead} The app could not compare your reps with the plan, ${tail}`
  if (rate < 1) return `${butLead} but your logged reps fell short of your target, ${tail}`
  if (sig.rm1Trend === 'down') return `${butLead} but your 1RM slipped, ${tail}`
  if (ctx.phase === 'realisation') return `${lead} Realisation does not add reps, ${tail}`
  // Every condition met and still no change: a compound at the top of its rep band.
  return `${lead} You are at the top of the rep range, ${tail}`
}

export interface AutoregExercise {
  sessionExerciseId: string
  sets: number
  reps: number
  pct: number
}

export interface AutoregExerciseSignal extends AutoregSignal {
  sessionExerciseId: string
  /** #3896: the lifter's own rep range for this lift. When set, "add reps" climbs to its top and the
   *  clamp holds reps inside it, instead of the goal's band for the role. */
  repBand?: { repMin: number; repMax: number }
}

// Apply the quadrant to a whole prescription. Pure: returns a new exercise array plus the set of
// exercises that earned an extra set (protected downstream by the time budget) and per-exercise
// explanation notes. Rounds pct to 0.5 and keeps reps inside the goal band.
export function applyAutoregulation(
  exercises: AutoregExercise[],
  signals: AutoregExerciseSignal[],
  trainingGoal: string,
  phase: string,
): { exercises: AutoregExercise[]; earnedSetIds: Set<string>; notes: Record<string, string> } {
  const earnedSetIds = new Set<string>()
  const notes: Record<string, string> = {}

  const out = exercises.map((ex) => {
    const sig = signals.find((s) => s.sessionExerciseId === ex.sessionExerciseId)
    if (!sig) return { ...ex }

    const band = sig.repBand ?? goalRange(trainingGoal, sig.role)
    const adj = computeRpeAdjustment(sig, { phase, currentReps: ex.reps, band })
    if (!adj.note) {
      // #4079: nothing changed; a tapped answer the rule did not act on is said back in the note.
      const unacted = unactedEffortNote(sig, { phase, currentReps: ex.reps, band })
      if (unacted) notes[ex.sessionExerciseId] = unacted
      return { ...ex }
    }

    const pct =
      adj.pctMultiplier === 1
        ? ex.pct
        : clamp(Math.round(ex.pct * adj.pctMultiplier * 2) / 2, PCT_HARD_FLOOR, 100)
    const reps =
      adj.repDelta !== 0
        ? clamp(ex.reps + adj.repDelta, band.repMin, Math.min(band.repMax, 30))
        : ex.reps
    const sets = ex.sets + adj.setDelta
    if (adj.setDelta > 0) earnedSetIds.add(ex.sessionExerciseId)
    notes[ex.sessionExerciseId] = adj.note

    return { ...ex, pct, reps, sets }
  })

  return { exercises: out, earnedSetIds, notes }
}

// Combined-deviation clamp: whatever the model chose plus whatever autoregulation cut,
// the final working pct never lands more than one full back-off (10%) below the phase
// zone's floor, and never rides above the phase zone's ceiling (a schema-valid but
// out-of-band pct, e.g. 98% in an accumulation block, must not reach the bar). pctMax is
// optional so existing floor-only callers/tests are unaffected. Rounded to 0.5 like all
// autoreg pcts.
export function clampPrescribedPct(pct: number, zone: { pctMin: number; pctMax?: number }): number {
  const floor = Math.round(zone.pctMin * (1 - BACKOFF_MAX_PCT / 100) * 2) / 2
  const ceiling = zone.pctMax ?? Infinity
  return Math.min(ceiling, Math.max(pct, floor))
}

/**
 * The `phase` the mid-session load-cut suggestion hands `computeRpeAdjustment`. A baseline week is
 * measuring and a deload's loads are deliberately light, so neither is offered a cut.
 *
 * `isDeload` is the SESSION's deload choice, not one exercise's `deloaded` flag: the current app and
 * Preview must agree on which sessions never see a cut, whatever a single exercise was flagged.
 */
export function loadCutPhase(ctx: { isBaseline?: boolean; isDeload?: boolean }): 'baseline' | 'deload' | 'normal' {
  return ctx.isBaseline ? 'baseline' : ctx.isDeload ? 'deload' : 'normal'
}
