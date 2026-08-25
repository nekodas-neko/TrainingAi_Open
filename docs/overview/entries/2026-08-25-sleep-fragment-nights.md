# Two readers were choosing the nap over the night (Q-274)

**Branch:** `fix/sleep-fragment-nights` · **Lane A** · no migration · user-visible

## The sizing pass changed what the entry was about

All history: **17 sleep rows under 1.5 h across 74 dates, 4 of them exactly 0.00 h.** Every single one
starts between **09:32 and 22:14 local** — daytime detections, not short nights.

Two of the entry's claims are now stale, and both would have sent this the wrong way:

1. **2026-08-11 and 2026-08-13 are no longer single-row dates.** Q-536's clock repair, which landed
   two days after this was filed, supplied their real nights. The only genuinely single-row fragment
   dates in all history are 2026-06-01 (1.45 h, Cloud-era) and 2026-08-22 (0.00 h).
2. **The readiness claim no longer holds.** `previousNight` and `sleepBalance` reach sleep through
   `readiness-payload.ts`, `sleep-trend.ts` and `score-audit/sleep.ts` — all three go through
   `nightSessions`, which already drops zero-duration rows and classifies naps out by circadian
   midpoint. **16 of the 17 fragments were already handled.**

## So the invariant was decided; the defect was readers that bypassed it

The entry says *"decide the invariant once, at the write or at `nightSessions`"*. It is decided, and
`sleep-night.ts` is a careful piece of work. What it does not do is reach every reader. Two were
choosing for themselves:

**`/api/day-log` picked `sleepRes.value[0]`.** `listSleepSessions` orders by **date only**, so within
a date the row order is whatever Postgres returns. On the 15 dates carrying both a fragment and the
night, the day log was choosing between them **by coin flip**. It now aggregates through
`nightSessions` and takes the longest night — chosen from the rows the query already restricted to
that date rather than re-deriving the wake day, because production carries rows whose stored date
disagrees with their local wake day.

**The sleep list rendered a 0.00 h night.** `mergeByDate`'s `primaryCluster` takes the longest row, so
nap-plus-night dates were already right; a date whose *only* row is zero-duration returns early from
the one-row fast path, and 2026-08-22 reached the list as a night of zero hours. A bed period the
recorder never resolved into sleep is not a short night — `computeSleepScore` already returns null
for it. The predicate is now imported from `sleep-night.ts` as `recordsSleep` rather than copied,
since a second copy is how the two drift.

## A finding this PR did NOT fix

**There are two implementations of "which rows are the night."** `sleep-night.ts` classifies by
circadian midpoint then merges within a 3 h gap; `lib/sleep/merge-sessions.ts` takes the longest row
plus anything within 1 h. They agree on the production history, which is why nothing has surfaced —
but *One Formula, One Place* calls two implementations of one metric a bug by definition. Converging
them changes the owner's main sleep surface and wants a device check, so it is filed as a `Keep:`
rather than smuggled into this diff.

## Verification

Eight tests, **both fixes proven by mutation**: reverting the day log to `value[0]` fails four of
five (including the ordering pair, which is the whole point — passing one order proves nothing), and
letting zero-duration rows through fails two of three.

- `pnpm check:rules` — Ran 56 of 56. `tsc --noEmit` clean, `pnpm lint` 0 errors.
- Full suite: 4754 passed, 51 skipped, 2 pre-existing unrelated failures (missing `qrcode`).

## Not exercised

**Nothing was seen on device**, and both changes are read paths on surfaces the owner looks at daily
— the day log and the sleep list. `pnpm dev` could not be run (missing `@sentry/nextjs`).

The write path still stores 0.00 h rows. That is now filtered at both read paths; whether the rollup
should refuse to write them at all is untouched. And 2026-06-01 still classifies as a 1.45 h night —
it sits in the night band, so the classifier is behaving as designed, and no decision was made about
whether that row should exist.
