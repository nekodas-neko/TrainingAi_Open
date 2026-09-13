# 2026-09-13 — BF-151: the bodyweight rep max is read, not reconstructed

**Branch:** `lane-a/bf151-bodyweight-rep-max` · **Agent:** Implementation Lane A

## The defect

For a bodyweight exercise the rep max *is* the reps performed, and `exercise_logs.avg_reps` stores
that figure exactly. The exercise-summary card recovered it instead by inverting a stored 1RM
estimate — reconstructing, lossily, a number the database already holds.

**One collision no inverse can resolve, which is what made this worth doing.** Verified by running
the formulas rather than trusting the entry: at bodyweight 70, `calcAmrap1RM` returns **80.25 for
both 5 and 6 reps** — the rep-factor gain from the extra rep is exactly cancelled by
`amrapScaleFactor`'s 1.0 → 0.97 step. `repMaxFromAmrapOneRm` returns the lower of the tie, which is
the most the stored number supports.

## What shipped

- **`getLastRealOneRmBatch` carries `avg_reps`** alongside the 1RM, and `LastRealOneRm` gains the
  field. The reps travel **with that 1RM** rather than coming from `lastLogs` — that map is the
  genuinely most recent log and can be a different, deloaded session, so pairing its reps with this
  1RM would describe two sessions as one.
- **`resolveWorkingBasisWithSource`** reports which input won; `resolveWorkingBasis` delegates to it
  so the usable-value predicate stays in one place, which is the whole point of that function being
  the single definition for every weight path.
- **`WorkoutExercise.prevRepMaxReps`**, populated only when the basis came from a logged set. A seed
  the user typed and an older program's PR have no reps behind them.
- **`bodyweightRepMax`** in `1rm.ts` — prefers stored reps, falls back to the inverse. The card calls
  it for both figures; this session's comes from the reps just logged.

## Decisions

- **The inverse is kept, not deleted.** A seed-derived basis and a historical series both arrive with
  no reps to hand, exactly as the entry's scope note says.
- **The choice lives in `1rm.ts`, not the card.** Both vitest projects run in a `node` environment
  and cannot parse JSX, so arithmetic inside a `.tsx` cannot be asserted at all — the condition that
  produced Q-401's two budgets on one screen, 274 kcal apart, both labelled "left".
- **The offline assembler gets `null`**, consistent with its `estimated1rm: null`: the local mirror
  has neither until the network fetch fills them.

## Verification

- **Driven against `pnpm dev` on both route paths** (`?tab=all` and the single-session tab). Bench
  Press returns `est1rm=98, prevRepMaxReps=8`, matching its stored `avg_reps`. **Deadlift returns a
  basis of 160 with `prevRepMaxReps: null`** — checked against the database rather than assumed: it
  has no logs at all, only a seed and a PR, so that null is the source guard working.
- **Mutation pass — 9 planted defects, 8 killed**, and the survivor is understood rather than
  ignored: dropping the SQL `estimated_1rm > 0` filter survives because a second JS-side `> 0` guard
  in the same function still excludes the row. Mutating **both together is killed**, so the test
  bites and the redundancy is real. Two equivalent controls survived as intended.
- **Two mutants survived the first pass and produced tests.** The source guard was never exercised,
  because the seed/PR cases left `lastRealOneRm` empty — the discriminating case is a log that
  exists but whose 1RM is unusable. And `Number.isFinite` was untested: `NaN > 0` is already false,
  so only **Infinity** reaches that guard.
- Full suite green (8,468 tests) with a `DATABASE_URL`, lint green, `pnpm check:rules` Ran 74 of 74.

## Not exercised

**No device run.** The two rep-max values render only under `isBodyweight`, so the check the entry
asks for is a bodyweight set on the S25 at a rep count other than 5 or 6 — the previous-session value
is the one that exercises the new payload field. Server and client both reach the device through
Railway with no APK rebuild.
