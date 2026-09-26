# Tuning — the outlier-gated rating prompt, and why three previous attempts decayed to zero

**Branch:** `tuning/outlier-gated-rating-prompt` · **2026-09-26**
**Filed:** `TN-81` (Lane A, engine) · `TN-82` (Lane B, surface) · amendment to `OR-171`
**Plan:** [`docs/superpowers/plans/2026-09-26-outlier-gated-rating-prompt.md`](../../superpowers/plans/2026-09-26-outlier-gated-rating-prompt.md)

## What prompted it

Asked what Tuning needed to keep going, the answer was an **outcome variable**, not more angles: 73
TN entries in the queue, and only `TN-73` ever produced a validated instrument. The cheapest missing
label is a daily subjective sleep rating, which had stopped.

The owner agreed to rate, with a design constraint: *"I'd like it to auto fill if the within the
normal range; and only ask/require input when its outside the median range - as in high or low"* —
and the same structure for reporting scores that feel wrong. He had said the same thing unprompted on
2026-09-25 answering `Q-72`, which `OR-171` already recorded. Saying it twice makes it settled
preference rather than a suggestion, and that is worth having on the record.

## What the measurement changed

`OR-171` left one open question — what counts as high or low enough to ask — and its premise was that
the current *prompt* is the problem. The second half turned out to be wrong in a way that changes the
remedy.

Morning check-ins, last 120 days of production:

| Month | morning sheets | `wake_mood` | sleep rating (touched) | `vs_yesterday` |
|-------|---------------:|------------:|-----------------------:|---------------:|
| 2026-07 | 28 | **17** | 0 | 0 |
| 2026-08 | 28 | 0 | **3** | 0 |
| 2026-09 | 26 | 0 | 0 | **2** |

**82 sheets submitted over three months.** He opens and saves the sheet two days in three — the
friction was never the sheet. In each month exactly one field collects a few answers and it is a
*different* field each month: the one newly added or newly moved to the top. Each decays to zero.
`perceived_recovery` is **0 touched in 102 check-ins**.

Three affordances, three positions, same outcome. `morning-checkin-sheet.tsx` already carries the
reasoning behind the third attempt, written when the second had failed — *"a question placed after two
the owner skips inherits their fate"* — and then placed the new question on the same sheet, where it
collected 2 of 82. So **a fourth field is the intervention that has failed three times**, and the fix
is that a gated day asks one question while an ordinary day asks none.

## The one place the proposal departs from what was asked

A tails-only sample cannot validate the score. It selects on the predictor under test, which biases
agreement *upward*, and the error that matters most — a night scored **normal** that he would have
called bad — is unsampled by construction. A random **1 in 5** of ordinary nights, rendered
identically so the two are indistinguishable, fixes it for under two extra prompts a month. That is
the only departure, and it is on a point he could not have been expected to anticipate.

## Two things found while checking feasibility

**The score the gate would fire on is stored nowhere.** `sleep_sessions` holds 119 rows for the last
120 days — `duration_hours` on all 119, `average_hrv_ms` on 102 — and `sleep_score` is non-null on
**0**. It is computed on read. So the score as shown has to be snapshotted beside the rating, or a
later scoring change silently rewrites the number each rating was given against and every pairing
decays into noise. That is now `TN-81`'s hard requirement.

**The honest-auto-fill machinery already exists.** `sleep_quality_feel_touched` was added by `TN-57`
because `sleep_quality` had been defaulted to `'ok'` for 91 days and two surfaces read that default
back as the owner's answer. An auto-fill writing `touched: true` would recreate that deliberately, so
the constraint is stated as a hard one in both the plan and the entry.
`suggestedSoreMuscles` is the in-repo precedent for the pre-fill-and-override shape.

## Two field mis-filings caught before they shipped

Both are the class the backlog's field rules exist for, and both were mine:

- `- **Reference:**` on the plan link would have classified two buildable entries as non-work **maps**
  (`scripts/lib/reference.js`), removing them from the work list entirely. Renamed to `- **Plan:**`.
- `Gate: owner` on `TN-82`'s copy review **parks** the entry, so nobody is ever tasked with getting
  the copy approved — the same trap `TN-78` hit earlier in this run. Replaced with `Ask:`, which gives
  visibility without blocking; verified it now prints under WAITING ON THE OWNER while `Needs: TN-81`
  does the real parking.

`check-backlog-pointers.js` then caught a third: `**Needs:** TN-81` written inline on the `Lane:`
bullet is **ignored**, which would have left `TN-82` READY ahead of its own engine half.

## Verification

`pnpm check:rules` — **Ran 80 of 80**, all passed. `check-backlog-pointers` — 534 entries, no
duplicates, all tagged. Docs-only: no runtime surface touched, so no device pass is owed by this PR
(`TN-82` owes one when it is built).

## Not done

Nothing is implemented — this is the planning half, per the backlog-driven two-PR rule. The
thresholds (28-night median/IQR, 4–6 prompts a month, 1-in-5 sampling) are starting values to be
re-measured once real prompts have fired: a gate firing twice a week is a daily field wearing a gate
and will decay the same way.
