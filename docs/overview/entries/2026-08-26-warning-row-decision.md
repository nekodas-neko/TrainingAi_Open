# 2026-08-26 — the warning goes in the row, as an icon

**Branch:** `docs/warning-row-decision` · docs-only · BugFix Intake

## The decision

Q-406's `Gate: owner` is cleared. The owner picked **A**: an amber triangle before the calorie
column, row shape otherwise untouched.

That gate had been the last thing holding Q-406 in the queue. Three of its four call sites were
converted to the shared `FoodRow` days ago; the fourth — the external food-database search row —
carries a macro-mismatch warning and an in-flight spinner, and the agreed row had nowhere to put
either.

## What made it answerable

The owner's first reply to the options in prose was *"Yeah I dont quite understand what part you are
talking about; can you show me all 3 ways?"* — which is the right response to a description of a
visual choice.

**Drawing it changed the question.** The three treatments were rendered at 412 dp against a
three-result search list rather than as isolated rows, because the argument is entirely about list
density: whether a warning is legible on its own was never in doubt; whether you can still scan past
it was. Reference:
<https://claude.ai/code/artifact/315b8a71-5f0d-4a18-a917-a2618b882c4f>.

**Q-395's twelve artboards do not cover this.** Checked — none of them draws a warning treatment,
which is why this needed its own drawing rather than a re-read of the mockups.

## Why A, in the entry's own words

- **B** was the honest runner-up and beats A on one axis: the reason is readable without a tap. It
  loses because it puts the sentence *in place of* the serving line, on exactly the rows where you
  most want to read the numbers and judge for yourself.
- **C** — a dedicated third line, which is what ships today on the unconverted row — shows the most
  and costs the most. Not the ragged row height, which is cosmetic, but the slot: three call sites
  would carry a prop they never fill, and the shared row goes back to being a wrapper around
  per-screen differences. Ending that is the entire purpose of Q-406.
- **A → C is additive** if the sentence later has to be visible in the list. C → A means touching
  every call site again. The entry says not to pre-build it.

## The half that never needed deciding

The in-flight spinner swaps the green `+` inside the same 16 px box. It is a state of an element the
row already has, not a new slot, so it works under any of the three treatments. The gate had bundled
it with the warning; only the warning was ever a question.

## Position, not a date

Q-406 is Lane B's **#5** — behind LA-30, BF-28, BF-32 and BF-31, and ahead of Q-395c. It is one call
site plus deleting a superseded comment, so it is small; the four ahead of it are not.
