# 2026-09-27 — LA-156: Home's streak reads the schedule (v1.477.15)

**Branch:** `fix/home-streak-reads-schedule` · **Lane:** Implementation B · **Entry:** `LA-156` (removed from the queue).

## What shipped

Home's streak card carried its own copy of the calendar-day rule with the rest gap hardcoded to
**2**. That is the *floor*, not the answer: `streakRestGapFor` raises it from the user's own
schedule, so someone training Mon+Tue gets 5 (BF-122a). Home could not do that because it never read
the schedule, so for a weekly user it under-reported against `/api/achievements`.

Home now calls the shared `computeDayStreak` with a schedule-derived gap. The rule lives once
(RV-216). For the owner — on a rotation, where the floor applies — nothing changes.

## ⚠ Deviation from the entry's "done when", stated rather than buried

`LA-156` asked for `app/session-select/compute-streak.ts` to be **deleted**. It survives as a **shape
adapter** with its rule removed, and the reason is measured: its caller is a size-ratcheted hotspot
at **1,444 lines against a 1,448 baseline** — four lines of headroom — and inlining the conversion
needed about six. The baton's own rule applies (*`check-component-size` refuses an append to a
hotspot, and the answer is the extraction you already owed, not shaving comments*). What the entry
was really asking for — that the duplicated **rule** is gone — is done: nothing in that file decides
what a streak is.

## The bug this would have shipped, caught by the adapter

**Home's date keys use slashes.** `dayKeyInTz` ends `.replace(/-/g, '/')`, while `computeDayStreak`
parses `` `${d}T00:00:00Z` `` — and `Date.parse('2026/09/27T00:00:00Z')` is **NaN**.

Passing Home's keys straight through would not throw. Every gap would be NaN, every comparison
false, and the card would quietly print a wrong number. Normalising in the adapter is the change's
load-bearing line, not tidying. It is pinned by a test that fails 5 of 6 without it.

## RV-57's contract updated, not weakened

`rv57-streak-lookback-contract.test.ts` pinned that this file imports `STREAK_LOOKBACK_DAYS` and
walks a loop to it. **The loop is gone**, so those two assertions were replaced:

- **The supplier assertion stays and is the half with teeth** — `app/api/streak-data/route.ts` still
  imports the constant. Narrow that window by hand and Home disagrees with `/api/achievements`,
  which reads the history directly. Control-run: deleting the route's import turns it red.
- **The consumer assertion is now structural** — it delegates to `computeDayStreak` and walks no
  window of its own, so BF-176's failure (a supplier narrower than the consumer manufacturing rest
  days out of missing keys) is **impossible rather than guarded**. A formula handed the dates has
  nothing to assume about their span.
- A third case keeps any bare `365` out.

## Verification

Both halves control-run: hardcoding the gap back to 2 fails the Mon+Tue case; removing the slash
normalisation fails **5 of 6**. `rv102-one-card-colour-table` failed briefly for an unrelated reason
worth knowing — those file-scanning tests enumerate via git, so a `rm` without `git add` leaves the
index naming a file that is gone and they die on `ENOENT`, not on anything in the diff.

Full suite **1,120 files / 10,555 tests, exit 0**, zero `[late-console]` escapes. Home rendered at
384 px with no page errors; the card still reads "— days" on the seeded account, which has no
history.

## Not exercised

The APK, and one thing the sandbox cannot show: **the behaviour change only appears for a user on a
weekly schedule with a gap longer than two days.** The owner is on a rotation, so his number is
unchanged by construction — which means the fix is verified by the unit tests and by structural
equality with `/api/achievements`, not by a number moving on his screen. The seeded account has no
streak at all, so the render proves the card paints, nothing more.
