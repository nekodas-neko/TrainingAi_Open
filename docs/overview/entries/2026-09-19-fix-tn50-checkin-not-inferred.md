# 2026-09-19 — TN-50: the check-in stops answering itself

**Lane B.** Branch `fix/tn50-checkin-not-inferred-from-readiness`, v1.459.0. Items 1 and 2 of TN-50,
plus item 3 discharged as a documented cutoff.

## What was wrong

`mood-checkin-sheet.tsx` opened with an energy level already selected, chosen by
`readinessToEnergy(readiness)`. Readiness set the default; the default usually went unchanged; the
check-in then scored **10% of that same readiness**. The loop closed inside a single day.

Tuning measured it over the 62 days carrying both a check-in and a readiness score: the saved level
was exactly what the auto-fill would have picked on **45 of them — 73%**, against roughly 20–25% by
chance. Lane A re-verified every figure independently before I built anything.

`pumped` had never once been logged, and not because it was never felt: `readinessToEnergy` had no
branch that returns it.

## The decision I had to make, and why the entry could not make it for me

The entry says to *"default to neutral"* and to have an unanswered check-in contribute **the
documented NEUTRAL 50**. Those two instructions cannot both be satisfied by picking a default:

- The middle *option* is `ok`, which scores **72** — `+22` above neutral. That is the current bias.
- The only level scoring exactly **50** is `low`, and a face labelled **Low** pre-selected every
  morning is not what "neutral" meant.
- `MoodLog.energyLevel` is **non-nullable** and lives in `packages/shared` — Lane A's path — so
  "unanswered" cannot be a stored value at all.

So **nothing is pre-selected**. Unanswered now means *no log*, which `checkinScoreFromEnergy(null)`
already scores as NEUTRAL 50 through a path that has always existed. That is the only reading which
delivers both halves of the owner's *"neutral by default… not infer"*: a fixed default would still
write a value he never chose, and would leave the column just as unreadable as before.

**The cost, stated plainly:** Save is disabled until a level is tapped, so the daily check-in gains
one tap. That tap is the entire thing the contributor exists to collect. Reversal is one line if the
owner would rather have the extra tap back.

**Expected effect on the number:** the readiness line will visibly *step down*, because 36 of those
62 days stored `ok` at 72 and an unanswered day is now 50. That is the correction working, not a
regression.

## Item 3, discharged rather than deferred

Lane A recommended a documented cutoff over a storage flag, and the reasoning holds: whether any
*past* row was auto-filled is a statistical inference, never a per-row fact, so a flag added now
would be empty exactly where the ambiguity lives. The cutoff is written into
[`docs/domains/readiness/README.md`](../../domains/readiness/README.md) — the pillar index a future
session actually reads — with the three consequences spelled out, including that TN-47's 6.5% figure
for `checkin` is affected and wants re-measuring on post-cutoff days.

## Verification, and the control that mattered

- `lib/__tests__/tn50-checkin-not-seeded-from-readiness.test.ts` — 6 cases. Pins the absence of the
  seed, the save guard, and the arithmetic that rules out a fixed default.
- `e2e/tn50-checkin-starts-unanswered.spec.ts` — reads the rendered picker: nothing selected, Save
  disabled, `pumped` selectable. It deliberately **does not save**, because a saved log would make
  the next run an *edit*, where a pre-selected level is correct and the spec would pass for the
  wrong reason forever.
- **⚠ The first version of that spec was VACUOUS, and only the control showed it.** Mutating the
  `useState` initialiser back to a level left the spec green — the reset effect fires on open and
  overwrites the initialiser, so the load-bearing line is the reset arm, not the initialiser.
  Mutating the reset arm turns it red on the right assertion. Both lines are pinned by the source
  guard, and the test file now says which one a future verifier must mutate.
- **Q-226's guard broke loudly and was re-anchored, not deleted.** It located its slice by
  `SRC.indexOf('setEnergy(readinessToEnergy(readiness))')` — a string this change removes. Its own
  `found the reset arm` meta-assertion is what caught it; without that the slice would have been
  empty and all seven Q-226 cases would have passed on absence.
- Full gate: `Ran 75 of 75` Custom Rules · **7696 vitest tests** · tsc clean · tests-typecheck at
  baseline · lint 0 (an `exhaustive-deps` suppression became unnecessary once the effect stopped
  reading `readiness`, and is gone).

## Not exercised

**The S25.** The sheet is a daily native surface and the change alters what it shows on open; the
web harness cannot speak for the device. Left on TN-50 as the residue, together with Tuning's
re-measure of TN-47 once post-cutoff days accumulate.
