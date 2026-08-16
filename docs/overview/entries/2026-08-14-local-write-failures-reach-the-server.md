# 2026-08-14 — a failed local write now falls through to the server (Q-216)

**Branch:** `claude/trainingai-backlog-v0abea`

#1292 made `runSQL` throw on the canonical runtime when the local DB is not open, so a local write
that used to fail silently now fails loudly. Every user-initiated write then needs the same shape: if
the local write throws, reach the server route rather than an error handler.

## The entry said two sites had the fallback. Twelve did.

The entry claimed *"only the two check-in sheets were given the fallback"* out of 34 files
referencing `getLocalStore`. Measured on current `main`: **40 files reference it, 24 write through
it, and 12 already carry the `savedLocally` fallback** — injury, manage-supplements,
supplements-section, done-activity, water-log, metric-log, log-value, quick-edit-log, overview,
morning-checkin, mood-checkin and exercise-review. Someone swept most of it after #1292.

Grepping for `savedLocally` also undercounts, which matters for the next sweep:
`components/fitness-tests/test-result.tsx` has the correct behaviour written a different way — the
local branch in its own `try`, falling through to the API on `catch`. **The audit has to be on
behaviour, not on the idiom**, or a correct site reads as a gap and a broken one hides behind the
right variable name.

## Four real gaps, all the same shape

`if (store) { …local… } else { …API… }` inside one `try`, so a throw from the store branch skipped
the `else` entirely and landed in the outer `catch`:

| Site | What was lost |
|---|---|
| `guided-walk/walk-summary.tsx` | a completed walk |
| `nutrition/end-of-day/end-of-day-review.tsx` | the end-of-day check-in |
| `nutrition/saved-meals-sheet.tsx` | a saved meal |
| `nutrition-content.tsx` (delete) | a food-log deletion |

**The walk is the worst, and not only because of the data.** Its handler read:

```ts
} catch {
  toast.error('Failed to save walk')
  setSaved(true) // optimistic; the outbox retries on device
}
```

The outbox write is exactly what had failed, so nothing was queued for it to retry — and `setSaved`
told the lifter it was safe. A walk with GPS, splits and pace series was gone while the screen said
otherwise. That catch now reports the failure and leaves the button live, because reaching it means
*both* paths failed and there is genuinely nothing queued.

`workout-screen.tsx` was checked and is **correct by design** — its local write is explicitly
best-effort (`.catch(warn)`) and the POST is the primary send, so a local failure cannot lose the
set. `running-plan-content.tsx` is API-first with the local write as a display mirror; a failure
there costs a repaint, not data.

## The size gate forced an extraction, and it was right to

Eight added lines pushed `saved-meals-sheet.tsx` from 797 to 805. Trimming comments got it to 802,
which is the wrong tool — the rule asks for extraction. So the quantity arithmetic moved to
`components/nutrition/saved-meal-qty.ts` (`qtyFromInput`, `steppedQty`), the file is **794** lines,
and maths that was never directly testable now has ten cases.

The two null returns are the load-bearing part and mean opposite things: `qtyFromInput` returns null
for "leave the row alone" (so a half-typed value never zeroes an ingredient), `steppedQty` returns
null for "remove the row". Both are pinned, along with the divide-by-zero guard for grams on a food
with no serving size.

## Verified

**The guard was run against the pre-fix files before being believed** — the Q-226 lesson applied up
front rather than afterwards. Stashing the four fixes fails **12 of 14** cases, exactly the ones
written for them. The extracted arithmetic is mutation-verified twice: dropping the gram
serving-size guard fails its case, and returning 0 instead of null on a zero step fails its own.

Full suite green — **465 files, 3,853 tests**. `tsc --noEmit` clean, lint 0 errors,
`pnpm check:rules` 33 of 33.

**Not exercised: the failure itself.** The whole point is what happens when the local SQLite write
throws, and `getLocalStore` returns null in this sandbox — so the branch being fixed cannot run here
at all. The guard checks the shape is present; only the S25 exercises it, and only with a local DB in
the state that makes `runSQL` throw. That is the same reason the gaps survived #1292's sweep.

Also not exercised: the extraction is behaviour-preserving by inspection and by its tests, but the
saved-meal builder's ± buttons have not been pressed on a device since.
