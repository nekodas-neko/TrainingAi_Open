import { displayOneRm, isBodyweightType } from '@trainingai/shared/1rm'
import { mround125 } from '@/components/workout/utils'

/** The baseline banner's suggestion for one exercise. */
export type BaselineHint =
  /** A load to put on the bar, in kilograms — `≈70% of PR`. */
  | { kind: 'load'; kg: number }
  /** Nothing to load. `repMax` is what the lifter has already done, when it is known. */
  | { kind: 'bodyweight'; repMax: number | null }
  /** No stored 1RM, so no basis for either. */
  | { kind: 'unknown' }

/**
 * What to suggest for a baseline AMRAP set — BF-127.
 *
 * The banner computed `mround125(current1rm * 0.7)` for every exercise and printed it with a
 * hardcoded `kg`. For a **bodyweight** movement that stored 1RM is not a weight: it is computed
 * against `BW_REF = 100` (`packages/shared/src/1rm.ts`), a fixed stand-in for the lifter's real body
 * weight, so it is an index driven by reps and added load. The owner's Pull-Up index of 118.25 became
 * *"82.5 kg"* — an instruction to hang 82.5 kg from a pull-up bar, against a real body weight of
 * 70.65 kg.
 *
 * **The repo already forbade this**, in a comment written after Q-12 found the same class:
 * *"bodyweight strength is measured in REPS, never kilograms … Every surface that shows a stored 1RM
 * resolves its unit here rather than hardcoding 'kg'."* This is that resolver, applied. The proof it
 * was reachable sat six lines below the banner, where the exercise card renders `5 RM` correctly for
 * the same exercise.
 *
 * **A bodyweight row offers no number to load, and does not invent one.** 70% of a rep max is not a
 * prescription — reps do not scale that way — so the row says there is nothing to add and reports the
 * rep max as the reference an AMRAP is measured against.
 */
export function baselineHint(current1rm: number | null | undefined, exerciseType: string | null | undefined): BaselineHint {
  if (isBodyweightType(exerciseType)) {
    return {
      kind: 'bodyweight',
      repMax: current1rm != null ? displayOneRm(current1rm, exerciseType).value : null,
    }
  }
  if (current1rm == null) return { kind: 'unknown' }
  return { kind: 'load', kg: mround125(current1rm * 0.7) }
}

/** Whether the banner's suggestion block has anything to say at all. */
export function hasAnyHint(hints: BaselineHint[]): boolean {
  return hints.some(h => h.kind !== 'unknown')
}
