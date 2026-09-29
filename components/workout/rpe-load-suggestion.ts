import { computeRpeAdjustment } from '@trainingai/shared/ai-periodization/autoregulation'
import { defaultRpeFromPct, mroundStep, weightStepFor } from './utils'

/** The set he just logged, as the card already holds it. */
export interface LoggedSetOutcome {
  /** What he set the RPE picker to. `undefined` on an exercise with no picker. */
  loggedRpe: number | undefined
  /** Reps he actually did — the rep dial's value once the set is logged. */
  repsDone: number | undefined
  /** Reps the style prescribed for that set. */
  prescribedReps: number | undefined
  /** The style's `pct` for that set, which is where the EXPECTED RPE comes from. */
  pct: number | undefined
}

export interface LoadSuggestion {
  /** The weight to pre-fill, already rounded to the equipment's step. */
  weightKg: number
  /** `computeRpeAdjustment`'s own sentence, so the card cannot describe the cut differently. */
  note: string
}

/**
 * The in-session half of autoregulation: what the app would do to this load next week, offered now.
 *
 * **BF-220.** He logged `13.75 kg × 6` at RPE 10 against a prescribed 7, and the next set card still
 * read `13.75 kg × 7`. `computeRpeAdjustment` had already decided that was too heavy — its back-off
 * condition (`rpeDelta ≥ RPE_DEAD_BAND` and the reps fell short) matched the moment he logged it —
 * but its only two call sites run at prescription-generation time, so nothing in the session reads
 * RPE at all. The signal he is asking to send is one the app captured and then sat on for a week.
 *
 * **It calls `computeRpeAdjustment` rather than re-deriving the rule**, so the in-session answer and
 * next week's answer cannot disagree. That matters more than it looks: `RPE_DEAD_BAND` is not
 * exported, and a second copy of the threshold here is exactly the divergence CLAUDE.md's
 * one-formula rule is about.
 *
 * ## Two deliberate narrowings
 *
 * **① `rm1Trend` is passed as `'flat'`, so only the missed-reps branch can fire.** The real trend
 * needs the exercise's history and is not on this screen. `'flat'` is the honest stand-in rather
 * than the convenient one: it can only ever *withhold* a suggestion (an exercise whose 1RM really is
 * sliding, logged at high RPE with the reps met, gets nothing here), never invent one. The case the
 * owner reported — high RPE and short reps — does not need the trend.
 *
 * **② A suggestion needs a real deviation, and an untouched picker cannot produce one.** `rpeValues`
 * is initialised to `defaultRpeFromPct(pct)`, so a set he never rated reads back as exactly the
 * expected RPE, `rpeDelta` is 0, and the dead band is not crossed. That is the same class as the
 * morning check-in storing a neutral `3` for a scale nobody tapped — here the arithmetic makes the
 * invented value inert, and a test pins it.
 */
export function rpeLoadSuggestion(
  prev: LoggedSetOutcome,
  currentWeightKg: number,
  ctx: { isBaseline?: boolean; isDeload?: boolean; exerciseType?: string; equipment?: string[] },
): LoadSuggestion | null {
  // Bodyweight work has no load to cut and no picker feeding a pct.
  if (ctx.exerciseType === 'bodyweight') return null
  if (prev.loggedRpe == null || prev.repsDone == null || prev.prescribedReps == null) return null
  if (prev.prescribedReps <= 0 || currentWeightKg <= 0) return null

  const adj = computeRpeAdjustment(
    {
      role: 'primary',
      rpeDelta: prev.loggedRpe - defaultRpeFromPct(prev.pct),
      rm1Trend: 'flat',
      repCompletionRate: prev.repsDone / prev.prescribedReps,
    },
    {
      // `computeRpeAdjustment` returns no adjustment at all in these two phases, which is the
      // behaviour to inherit rather than re-decide: a deload's loads are deliberately light and a
      // baseline week is measuring, so neither wants a cut offered mid-session.
      phase: ctx.isBaseline ? 'baseline' : ctx.isDeload ? 'deload' : 'normal',
      // Back-off reads neither of these; they belong to the rep-push branch, which cannot fire on a
      // `'flat'` trend with the reps short. Passed as the set's own values so nothing is invented.
      currentReps: prev.prescribedReps,
      band: { repMin: prev.prescribedReps, repMax: prev.prescribedReps },
    },
  )

  // Only a load cut is offered. A rep push is the other branch of the same function and is not
  // this entry's ask — and `pctMultiplier === 1` covers every no-op case in one read.
  if (adj.pctMultiplier >= 1 || adj.note == null) return null

  const weightKg = mroundStep(currentWeightKg * adj.pctMultiplier, weightStepFor(ctx.equipment))
  // A cut that rounds back to the weight already on the card is not a suggestion.
  if (weightKg >= currentWeightKg) return null

  return { weightKg, note: adj.note }
}
