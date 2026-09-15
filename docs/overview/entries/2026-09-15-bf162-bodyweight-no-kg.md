# 2026-09-15 — BF-162: the prescription card told you to load 85 kg onto a Hanging Leg Raise

**Lane B.** Branch `fix/bf162-bodyweight-no-kg`.

## The report

The owner, reading his Legs prescription: *"Is this right?"*

It was not, and it was arithmetic rather than an anomaly — reproduced exactly from his stored values:

| exercise | stored `estimated_1rm` | × pct | card showed |
|---|---|---|---|
| Hanging Leg Raise | 128 | × 66% = 84.5 | **`@ 85kg (66%)`** |
| Pull-Up (14 Sept) | 124 | × 72.5% = 89.9 | **`@ 90kg (72.5%)`** |

Both are `exercise_type = 'bodyweight'`. There is no bar to load: the kg figure is a percentage of an
internal index derived from reps (BF-149), not a weight.

## The rule already existed and was applied to the wrong half

`packages/shared/src/1rm.ts` says it in its own module comment — *"Every surface that shows a stored
1RM resolves its unit here rather than hardcoding kg"* — and exports `isBodyweightType` /
`oneRmUnit` for exactly this. **Q-19 applied that rule to the card's RATIONALE and not to its
exercise rows**, which kept computing `oneRm × pct` unconditionally.

So the fix is one guard on `weightKg`, using the shared predicate rather than a ninth inline
`=== 'bodyweight'` (there were eight already). A bodyweight exercise now falls through to the
`@ ${ex.pct}%` branch **the card already renders** whenever a 1RM is missing — visible today on
*Face Pull · 2×12 @ 66%*, which reads correctly.

## What was deliberately not done

**Relabelling the number as added weight.** 85 is 66% of a 128 index, so calling it "added" would
turn a visibly absurd number into a plausible wrong one — the trap BF-158 was filed against. There
is a test asserting no such wording creeps in.

**A rep target.** `avg_reps` is stored and BF-151 is already about reading it. Percent with no kg is
complete on its own; a rep target is a further improvement, not this.

## Verified

- `pnpm check:rules` **Ran 75 of 75**, all passed · `tsc --noEmit` clean · `pnpm lint` 0 errors.
- `components/workout/__tests__/bf162-bodyweight-no-kg.test.ts` — 5 tests. It pins the owner's two
  real numbers, so the arithmetic that produced the report is the thing under test; it asserts the
  guard sits on the **`weightKg` computation** rather than on the render, because a guard on the
  render alone still computes a figure for the next reader to wire back in.

## Not exercised

**No e2e, and the reason is the seed rather than the change.** There are 27 bodyweight exercises in
`exercise_library` and **none of them is in any `session_exercises` row**, so the harness cannot
render a prescription row for one without inventing fixture state. Seeding that would test a
situation I had constructed rather than the one the owner hit.

**No device pass.** Per the entry: open a session containing a bodyweight exercise and confirm no kg
is shown for it while weighted exercises in the same list are unchanged.
