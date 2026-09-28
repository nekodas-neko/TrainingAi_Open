# 2026-09-28 — closing four asks that were already answered, and one that was answerable

**Branch:** `chore/or-close-answered-asks` · Orchestrator

`Ask: owner` was 12. Five of those needed no answer from him: three were already resolved elsewhere,
one was routed to the wrong place, and one turned out to be derivable from the repo. **Now 8.**

## Struck as complete

- **`BF-202`** — both sweep passes are run and all thirteen buried decisions carry an `Ask:`. Its
  own text said to strike it once they were surfaced.
- **`RV-170`** — the history-row policy was settled on 2026-09-24 and **both riders are now
  resolved**: `RV-164`'s 1,618-vs-1,660 question is the blocking input on `OR-191`, where it
  belongs, and `RV-166` was dissolved by merging walk and run.

## The check that made striking `RV-170` safe

I wrote that the policy "is recorded in each of" the five entries that cite it, then checked rather
than shipping the claim. **Four of five restate it; `LA-21` did not.** Striking the entry would have
left `LA-21` pointing at a policy with no surviving statement anywhere it could reach. The policy —
recompute-from-stored-inputs **yes**, hand-edits **no**, per `BF-81` — is now written into `LA-21`
in the same change, with its own limb named: the midnight `started_at` rows are a hand-edit, so
**mark them known-bad rather than rewriting them**.

## Shrunk

**`RV-221`** — items 1 and 2 are closed. The `RV-213` mockup is no longer owed because the change
was **declined** on 2026-09-27, and the calorie target is `OR-191` now. Only the merge-time yes on
six security fixes remains, and that is needed when each PR goes green, not now.

## Re-routed, not deferred

**`BF-201`** decision 2 — the rep→%1RM table — goes to **`Lane: T`** before it goes to him. The
entry's own text sets the bar: *"Tuning owes … a proposal stating how many of his past sessions the
change would move."* Picking a table without that number is picking blind, and the recommendation
turns on exactly that quantity — the observed curve is recommended *because* it changes nothing on
day one, against a textbook table that would silently re-weight every session. The proposal makes
the question answerable. **Decision 1 (the p75 margin) is not blocked by this** and ships with
`BF-197`.

## Answered here rather than asked

**`LB-173`** — which of the two "Start Workout" buttons should change. The entry declined to
recommend, saying *"there is nothing in the repo that favours either direction"* and that choosing
would be *"dressing a coin toss as analysis"*. Honest, and untested.

**Measured across `components/**` and `app/**`: of 43 full-width primary `<Button>`s, 33 are
text-only and 10 carry a decorative leading icon — 77%.** (Eight more render a `Loader2` spinner
while saving; those are a state indicator, not a leading icon, and counting them would have put the
split at 18 v 33 and muddied it.) So the session card is the house convention and the pre-workout
screen is the outlier. **Drop the dumbbell.** It is a restyle fixing a consistency defect, which
CLAUDE.md's mockup rule explicitly exempts, and it is the opposite shape to `LB-164` — that was
adding a label he never asked for; this removes an inconsistency in the direction 33 other buttons
already point. Lane B, two lines.

**Not exercised:** documentation only. Gates: `Ran 83 of 83` Custom Rules, `check-doc-links`,
`check-backlog-pointers` — clean by exit code.
