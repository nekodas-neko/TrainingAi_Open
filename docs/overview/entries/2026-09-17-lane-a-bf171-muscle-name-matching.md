# 2026-09-17 — BF-171: the session picker was the one consumer matching muscle names raw

**Branch:** `lane-a/bf171-muscle-name-matching` · **Lane A** · no migration · shipped behind BF-173, which its `Needs:` required

## What was wrong

`sessionRecoveryScore` compared muscle names with exact lowercased equality, on both sides. Two limbs:

**A sore "Back" clamped nothing.** The check-in offers **Back** as a pill. The exercise library has
no muscle called `back` — it has `lats`, `upper back` and `traps` — so the comparison matched none of
them. Measured before the fix: adding `Back` to the sore list moved **every** session score by zero.
A lifter whose back is wrecked was recommended Pull and Upper at full confidence.

**`core` never found its own recovery.** `computeMuscleRecovery` keys its output through
`normalizeMuscle`, which folds `core` → `abs`; the assignments it was matched against say `core`. The
lookup missed, and a miss returns **100** — so a synonym mismatch was indistinguishable from a fully
rested muscle, while the real value sat in the same payload at 86.

**This was the seventh consumer, and the only one matching raw.** `moodMuscleMatches` exists in
`packages/shared/src/muscles.ts` for exactly this job and is used by `per-exercise-deload`,
`signals` (twice), `soreness-volume`, `suggested-soreness` and `workout-data` (twice). The one that
*picks the session* was the exception.

## What shipped

`recoveryPct` compares `normalizeMuscle` on both sides. The sore test becomes
`lifterAdded.some(label => moodMuscleMatches(muscle, label))` — a list rather than a set, because a
pill is a broad **region** covering several catalogue muscles, so membership was never the right
question.

No synonym list was hand-rolled here. `muscles.ts`'s own header records cleaning up exactly that
divergence once already.

## It composes with BF-173, and that needed checking rather than assuming

BF-173 (merged hours earlier) had just made the clamp fire only for **lifter-added** ticks. BF-171
changes which muscles a tick *reaches*. Shipped in the wrong order this entry would have made the
recommendation worse — every newly-matched muscle would have been fed into a live double count,
which is what its `Needs: BF-173` was protecting. A test pins the composition: a **suggested** `Back`
tick still does not clamp, even though it now matches three muscles it previously matched none of.

## The both-directions check the entry demanded

The entry refused to be done until the fix was measured moving scores in both directions, because
its two limbs cancelled in one place. Eight of the nine cases lower a score or leave it. **The one
that raises came from somewhere the entry did not anticipate** — normalising the BF-173 provenance
filter, not the name matching. Stored provenance saying `Core` against a tick saying `Abs` were two
different strings under the old lowercased comparison, so an accepted suggestion read as
lifter-added and clamped to 40. They are one muscle; it now falls through to its real 86. A mutant
reverting just that comparison kills the case, so it is load-bearing rather than incidental.

## Verification

- 9 unit tests; **5 of 9 fail against `main`** — checked by running them against `origin/main`'s
  version of the file, not by reasoning about it.
- **Mutation pass: 5 mutants, all killed** — each limb reverted separately, the provenance filter
  dropped, the secondary multiplier turned into the clamp, and the provenance comparison returned to
  `toLowerCase`. **Equivalent control** (`some(f)` → `!every(!f)`) stayed green.
- One case pins that matching stayed *specific*: `moodMuscleMatches` falls back to a substring test,
  so a `Quads` pill reaching a back session is a real risk and is asserted against.

**Not exercised:** the entry's production deltas (Legs 59 → 62, Lower 74 → 77) were **not
re-measured** — they came from a scratch harness against the owner's rows, and the fixtures here are
synthetic. No device: pure shared math, as the entry says. What is proved is the behaviour, not the
new numbers on his screen.
