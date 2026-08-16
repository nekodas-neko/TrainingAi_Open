// What a bodyweight rep actually loads — the missing price in every volume calculation.
//
// Audit finding Q-13: `log-exercise.ts` priced a bodyweight set at `BW_REF + added` for the 1RM and
// intensity, but computed VOLUME from the raw logged weight — which is 0 for an unloaded bodyweight
// set. So the same rows read as 82–88% intensity and zero work done, and 208 real reps were absent
// from lifetime volume, weekly volume, `computeVolumeAcwr` (which gates the early-deload
// recommendation) and the prescription engine's own volume budget.
//
// Owner decision (2026-07-27): price it at the lifter's REAL body weight times a per-exercise
// fraction — the only option where the number means "work done". Deliberately NOT `BW_REF`: that
// constant exists so the 1RM estimate stops tracking weigh-ins (see lib/1rm.ts), and reusing it
// here would put ~100 kg on every rep and let bodyweight movements dominate the totals.
//
// ## Where the fractions come from
//
// Standard segmental mass fractions (Dempster/Winter): each leg ≈ 16.1% of body mass, head ≈ 8.1%,
// trunk ≈ 49.7%. A movement's factor is the share of body mass its prime movers actually raise.
// These are population averages, not measurements of this lifter — they are good enough to make
// volume comparable across exercises, which is what volume is for, and they are wrong in the same
// direction for everyone.
//
// Only Pull-Up and Hanging Leg Raise carry logged data today; the rest are here so a newly-used
// movement is never silently unpriced.

/** Body-mass share raised by each movement. `null` = deliberately not priced (see ISOMETRIC below). */
const FACTORS: Record<string, number | null> = {
  // Whole body suspended or pressed — effectively all of it.
  'pull-up': 1.0,
  'chin-up': 1.0,
  'weighted dip': 1.0,
  'burpee': 1.0,

  // Prone press: the classic measured figure for a standard push-up is ~64% of body mass.
  'push-up': 0.64,
  'diamond push-up': 0.64,
  'pike push-up': 0.70,   // hips raised — more mass shifted over the shoulders

  // Horizontal pull. Highly dependent on body angle; 0.60 is the mid of the usual 0.55–0.65 range.
  'inverted row': 0.60,

  // Hip/knee posterior chain, torso above the knees.
  'nordic hamstring curl': 0.65,
  'glute-ham raise': 0.65,

  // Trunk flexion raising the legs: both legs ≈ 32% of body mass.
  'hanging leg raise': 0.32,
  'leg raise': 0.32,
  'hip flexor raise': 0.32,
  'v-up': 0.32,
  'toe touch crunch': 0.32,

  // Trunk flexion raising head + upper trunk only.
  'crunch': 0.30,
  'decline crunch': 0.30,
  'bicycle crunch': 0.30,
  'dead bug': 0.30,
  'ab wheel': 0.55,

  // Single-leg hip work — one leg ≈ 16% of body mass.
  'donkey kick': 0.16,
  'fire hydrant': 0.16,
  'mountain climbers': 0.35,

  // Isometric holds. Their "reps" are seconds, not repetitions, so reps × load is not work in the
  // same currency as every other row — pricing them would corrupt the totals rather than complete
  // them. Left unpriced on purpose; volume stays 0 and the set still counts as a set.
  'plank': null,
  'side plank': null,
}

/**
 * Fallback for a bodyweight movement not in the table above — roughly a torso-and-arms press.
 * A newly-added exercise gets a plausible price rather than silently reverting to zero volume;
 * add it to FACTORS when its real share is known.
 */
export const BODYWEIGHT_LOAD_DEFAULT = 0.65

/** The share of body mass this movement raises, or null when it is deliberately unpriced. */
export function bodyweightLoadFactor(exerciseName: string): number | null {
  const key = exerciseName.trim().toLowerCase()
  return key in FACTORS ? FACTORS[key] : BODYWEIGHT_LOAD_DEFAULT
}

/**
 * The load (kg) one rep of a bodyweight set moves: the lifter's own mass share, plus any added
 * plate (or minus assistance, which is logged as a negative weight).
 *
 * Returns 0 when the movement is unpriced or no weigh-in is available — volume then behaves exactly
 * as it did before, rather than inventing a body weight.
 */
export function bodyweightSetLoadKg(
  exerciseName: string,
  bodyweightKg: number | null | undefined,
  addedKg: number,
): number {
  const factor = bodyweightLoadFactor(exerciseName)
  if (factor == null || bodyweightKg == null || bodyweightKg <= 0) return Math.max(0, addedKg)
  return Math.max(0, bodyweightKg * factor + addedKg)
}
