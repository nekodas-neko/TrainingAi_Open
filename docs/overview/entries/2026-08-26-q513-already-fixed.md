# 2026-08-26 — Q-513's window was already 28 days, so there was nothing to implement

**Branch:** `fix/build-day-audit-acwr-window` · **Lane A** · docs only.

Q-513 says `score-audit/build-day-audit.ts` passes **all history** to `computeVolumeAcwr`, making the
chronic denominator a *lifetime* weekly average — inflating the ratio, disagreeing with the engine's
band on **38% of days**, and showing `very_high` on three days the engine never saw past `high`.

Checked against current `main` before implementing, which is the habit that has now changed the work
on eleven consecutive entries. **The code already does what the entry asks.**

| | |
|---|---|
| `build-day-audit.ts` | `AUDIT_HISTORY_DAYS = 28`, fetches `getWorkoutSessionsFrom(userId, dayMid − 28d)` |
| `readiness-payload.ts` (engine) | `from28dDate = todayMid − 28d` |
| banding | both through `ACWR_THRESHOLDS` |

Same 7:28 shape, each anchored at its own day. The "lifetime weekly average" mechanism the entry
describes is not what the file does.

## What I did not conclude

`git log` attributes the 28-day constant to #137 on 2026-08-19 — a day after Q-513 was filed — which
would make it an incidental fix by unrelated work. **This clone is depth-limited and that same commit
shows the file as a 280-line pure addition**, which is what a shallow boundary or the public-repo
import looks like as much as a real creation. So the attribution is not load-bearing here and is not
claimed: what is verified is the code as it stands, read directly.

## What is still owed, and it is not Lane A's

The entry's second half — *"then re-measure"* — has **not** been done. Nobody has re-run the 88-day
replay against the current window, so **38% of days, mean |difference| 0.150, three days past the
emergency-deload line are all unconfirmed and may already be zero.** That replay is Tuning's tooling
and Tuning's proposal to make; Lane A has nothing to implement until it says otherwise.

So the entry **stays in the queue with a `Keep:` and `Gate: owner`** rather than being deleted. Deleting
it would lose a real open question; implementing it would have meant changing a window that is already
correct, which is the "forcing a mismatched implementation just to clear the queue" that CLAUDE.md
names outright.

## Verified

- `pnpm check:rules` **Ran 59 of 59** · `check-backlog-pointers` OK at 204 entries · Q-513 confirmed
  moved out of READY into the gated set by `next-item.js`, not inferred from the diff.

## Not exercised

Prose only. No code, no measurement — and the measurement is precisely what is still owed.
