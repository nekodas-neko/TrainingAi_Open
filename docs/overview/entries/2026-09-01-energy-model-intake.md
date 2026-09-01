# 2026-09-01 — the energy-model intake (BF-86, BF-87, BF-88)

BugFix intake. Three entries filed and merged across #714, #715, #718 and #721, plus the amendments
that followed each owner reply. No code changed; the entries are the deliverable.

## What the owner asked, three times

*"is basic steps being counted towards calorie burn? It says I've done 1000 but not sure if that's
counting towards nutrition."*

The app was right and the screen could not say so. `STEP_BASELINE = 3000` means only steps above
3,000 earn calories — deliberate, because the resting base is `RMR × 1.2` and a desk day's incidental
stepping is already inside that multiplier. At 1,196 steps the honest answer is zero, given without
the reason. That is **BF-87**, a copy fix.

Then: *"can we get rid of the baseline and have it reference steps + exercise only? rmr + activity?"*

Measured rather than reasoned about, and the answer was no. Dropping the multiplier to 1.0 and
counting every step gives a **lower** burn on **124 of 124 days** — mean **−177 kcal**, never higher —
because the `0.2 × RMR` it deletes is 265 kcal while the 3,000 steps it gains are ~106. Tracing it
turned up **BF-88**: `STEP_BASELINE` changes total burn on the formula path but is nearly
self-cancelling on the calibrated one, since the steps it adds to today are also added to the average
subtracted out of maintenance. One constant, two behaviours, nothing on screen distinguishing them.

Then: *"cant we remove some calories for the base 3000 and have it start from 0 steps?"*

**That one is right, and it is now approved to ship.** It conserves where the previous version
deleted — subtract exactly the 102 kcal it hands back:

| steps | 0 | 1,196 | 2,000 | 3,000 | 5,000 | 7,000 | 10,000 | 15,000 |
|---|---|---|---|---|---|---|---|---|
| current | 1590 | 1590 | 1590 | 1590 | 1658 | 1726 | 1827 | 1997 |
| proposed | 1488 | 1529 | 1556 | 1590 | 1658 | 1725 | 1827 | 1997 |
| delta | −102 | −61 | −34 | **0** | **0** | −1 | **0** | **0** |

Identical at and above 3,000 steps — a reparameterisation there, not a re-scoring. 74 of 124 days
unchanged exactly, 50 moved, mean −43, **−17 averaged across all days**. And it collapses BF-87's ask
to a single linear rate: **~34 kcal per 1,000 steps, from the first step**, with no threshold left to
explain.

## Also filed

**BF-86** — the morning check-in never re-prompts. `session-select-content.tsx` prompts from an effect
with deps `[userId, tz]`, neither of which changes, inside a tab shell that never unmounts, so it runs
once per app launch. The fix pattern is ten lines above it (`tabEpoch`) and the guard is already
date-stamped, so re-running is idempotent. The entry argues **against** the owner's literal ask — a
scheduled reload — because BF-80's blank-screen investigation was live at the time and a reload would
have given it a second candidate cause.

## Decisions

| Decision | Recorded in |
|---|---|
| Subtract the first 3,000 steps' worth from the resting base, count steps from zero. `Gate: owner` cleared 2026-09-01 | BF-88 |
| Keep `SEDENTARY_MULTIPLIER` and the measured-RMR base as they are — the model question is closed | BF-88 |

## Two things worth carrying forward

**A superseded recommendation gets deleted, not appended to.** BF-88's original advice was "leave both
constants alone"; BF-87 carried "do not lower `STEP_BASELINE`". Both were correct about the
uncompensated change and would have made an implementer refuse the approved one. They were rewritten
in the same diff that created the new recommendation.

**A `Needs:` can invert.** BF-88 waited on BF-87 while it was only "make the path legible". Now that
it changes the model, BF-87 waits on BF-88 — ship the copy first and you write a threshold sentence
onto a card that is about to stop having a threshold. Worth re-checking direction after any amendment
that changes an entry's recommendation.
