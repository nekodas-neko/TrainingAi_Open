import type { ExerciseRole } from '../types/program'

/**
 * Recommend the training role for an exercise, from what the catalogue knows about it (Q-405).
 *
 * **Why this matters more than a badge:** `resolveStyleForExercise` selects the progression style
 * from the role, so the role decides the prescribed percentages and sets. A Coach swap used to carry
 * the *outgoing* exercise's role onto the incoming one, which prescribed 60 kg × 6 at 80% for a
 * Jefferson Curl — a heavy secondary loading pattern on a slow spinal-flexion movement. A wrong role
 * is a wrong prescription, on a movement class where that carries injury risk.
 *
 * **Only ever called with a CURATED catalogue entry.** An exercise the Coach has just invented
 * carries model-proposed muscles, and deriving a role from those is deriving it from model output —
 * which `CLAUDE.md` forbids for anything that gates an automatic action. Callers pass `null` for that
 * case and handle it explicitly; see `recommendExerciseRole`'s return contract.
 *
 * **The signal is TOTAL muscle count, not the number of `main` muscles**, and that was measured
 * rather than assumed: 117 of the 142 catalogue exercises carry exactly one `main` muscle — Barbell
 * Bench Press among them — so a "2+ main muscles = compound" rule calls the bench press an
 * isolation. Counting every muscle the entry lists separates them properly: Bench Press 3
 * (chest main + shoulders/triceps secondary), Barbell Curl 2, Concentration Curl 1, Deadlift 5.
 *
 * Equipment then splits compound movements: a barbell compound is the thing a session is built
 * around, while the same movement pattern on dumbbells, a machine or a cable is what follows it.
 * Equipment is a closed set of six values in this catalogue (`barbell`, `dumbbell`, `cable`,
 * `machine`, `bodyweight`, `kettlebell`).
 *
 * **Validated against all 142 catalogue rows, not sampled** — 16 primary, 39 secondary, 86
 * accessory, 1 unrecommendable. Every one of the 16 primaries is a barbell movement a session is
 * genuinely built around (squat, deadlift and its variants, bench, overhead press, the barbell
 * rows), with no isolation among them: **Barbell Preacher Curl and Barbell Wrist Curl land in
 * accessory**, which is the check that matters, because it proves the barbell alone does not promote.
 *
 * **The known imprecision, stated rather than hidden:** three bodyweight core/conditioning movements
 * (Plank, Side Plank, Mountain Climbers) come out `secondary` on their three listed muscles.
 * Demoting bodyweight wholesale would fix them and break Pull-Up, Chin-Up, Push-Up and Inverted Row,
 * which are real compound movements someone would build a session around — and `exercise_type` is
 * not a reliable discriminator either (Glute-Ham Raise is typed `bodyweight` with `machine`
 * equipment). A plank is also far less likely to be swapped in as a loaded movement than a pull-up
 * is, so the trade runs this way round. This is a recommendation the user confirms, not a silent
 * write.
 */

/** Below this, an exercise is an isolation movement whatever it is loaded with. */
const COMPOUND_MUSCLE_COUNT = 3

/** The one piece of equipment that makes a compound movement a session's anchor rather than its support. */
const ANCHOR_EQUIPMENT = 'barbell'

export interface RoleRecommendationInput {
  /** The catalogue entry's muscles, main and secondary alike — the count is what matters. */
  muscles: { muscle: string; role?: string }[]
  equipment: string[]
}

/**
 * The recommended role, or **`null` when there is nothing to recommend from** — an entry with no
 * muscles recorded. Null means *ask*, and it must never be turned into a default by the caller:
 * silently inheriting is the bug this exists to fix, and silently guessing is the one it would
 * replace it with.
 */
export function recommendExerciseRole(entry: RoleRecommendationInput | null): ExerciseRole | null {
  if (!entry || entry.muscles.length === 0) return null

  if (entry.muscles.length < COMPOUND_MUSCLE_COUNT) return 'accessory'

  const isAnchored = entry.equipment.some(e => e.toLowerCase() === ANCHOR_EQUIPMENT)
  return isAnchored ? 'primary' : 'secondary'
}

/**
 * The role to write when a swap's incoming exercise has just been created from model-proposed
 * muscles.
 *
 * **Not the outgoing role**, which is the defect, and not a derived one, which would launder model
 * output into a prescription. `accessory` is the deliberate floor: it selects the lightest
 * progression style, so being wrong here under-loads rather than putting a heavy percentage on a
 * movement nobody has classified. The preview says what it did, so the user can correct it.
 */
export const UNCLASSIFIED_EXERCISE_ROLE: ExerciseRole = 'accessory'

/**
 * Cap a generated session at one `primary`, demoting any extra to `secondary` (BF-126).
 *
 * **Why this is checked in code rather than asked for in the prompt.** `/api/generate-program`
 * (`route.ts` rule 3) and `/api/builder-chat` both ask the model for a role per exercise and then
 * *enforce the progression style from that role*, never falling back to the model's own style
 * choice. So the role the model returns picks the percentages and set count — it is a prescription,
 * and `CLAUDE.md`'s AI defaults say structure a model returns is checked in code rather than
 * trusted. Nothing checked it: no rule caps any role, and rule 6's compound:isolation split is
 * advisory prose. Two primaries in one session is two exercises at the goal's heaviest band where
 * the owner's programs carry one.
 *
 * **Measured before the rule was chosen, because a rule fitted to one sample forbids a legitimate
 * session.** Across the owner's 22 real program sessions, 18 carry exactly one primary; the four
 * that do not are one legacy program that marked every exercise primary, and one session with none.
 * **Secondaries are deliberately NOT capped**: two per session is his normal in 10 of those
 * sessions, and it is what the generator returns in every sample below — so a "at most one
 * secondary" rule would demote what he actually keeps.
 *
 * **This did not reproduce on 44 generated sessions** (10 programs, two goals, 4- and 5-exercise
 * budgets, 4- and 5-day splits): every one came back with exactly one primary. It is a guard against
 * a model that stops complying, not a fix for an observed miscount — the owner saw it once, and
 * nothing in code would catch it happening again.
 *
 * **Never promotes and never reorders.** A session with zero primaries is left alone: the owner
 * keeps one such session, and promoting would raise load, which is the direction that hurts. Order
 * is untouched because the owner confirmed a lighter compound before the main lift is deliberate
 * ("that order is how I want it!") — so the primary that survives is the FIRST in the returned
 * order, which is arbitrary between two equal candidates but deterministic, and demotion to
 * `secondary` keeps it a compound rather than dropping it to isolation.
 */
export function capPrimariesPerSession<T extends { exerciseRole?: string }>(exercises: T[]): T[] {
  let seenPrimary = false
  return exercises.map(ex => {
    if (ex.exerciseRole !== 'primary') return ex
    if (!seenPrimary) {
      seenPrimary = true
      return ex
    }
    return { ...ex, exerciseRole: 'secondary' }
  })
}
