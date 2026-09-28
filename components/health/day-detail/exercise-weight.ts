import { isBodyweightType } from "@trainingai/shared/1rm";
import type { DayExercise } from "@/app/api/day-log/route";

/**
 * The weight cell for one exercise row (LA-164).
 *
 * A chin-up used to read **`0kg`**, which is not a small number — it is the wrong quantity. Nothing
 * was added to the bar, and the lift is the body. `/api/day-log` now carries `exerciseType`
 * (resolved from `exercise_library` via `exercise_logs.exercise_id`, RV-219's engine half), so the
 * card can say so.
 *
 * `BW` alone rather than `BW 0kg`: the added weight is zero and printing a zero is how this read
 * wrong in the first place. Added weight keeps its unit, because `BW +10` is ambiguous without one.
 * A non-bodyweight lift is untouched, including the em dash for an unrecorded weight — absent is
 * not the same as bodyweight, and only `exerciseType` can tell them apart.
 */
export function exerciseWeight(ex: Pick<DayExercise, "weightKg" | "exerciseType">): { value: string | number; unit: string | null } {
  // A weighted lift is returned UNCHANGED, em dash and all: "—kg" for an unrecorded weight reads
  // oddly, and tidying it here would be a second change hiding inside this one.
  if (!isBodyweightType(ex.exerciseType)) return { value: ex.weightKg ?? "\u2014", unit: "kg" };
  return ex.weightKg ? { value: `BW +${ex.weightKg}`, unit: "kg" } : { value: "BW", unit: null };
}
