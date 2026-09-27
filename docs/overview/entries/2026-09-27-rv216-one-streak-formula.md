# RV-216 — a best streak below the current one, because the two were counting different things

**Branch:** `feat/rv216-one-streak-formula` · **Lane A** · no migration

## Not two copies of one formula

RV-216 files this as the *one formula, one place* class: two functions named `computeStreak`,
Home saying 111 and More saying "best 49", and a best below a current is impossible.

The first half is right. The diagnosis is not, and it changes the fix.

They count **different quantities**:

- `app/session-select/compute-streak.ts` does `count += 1 + consecutiveRest` — a bridged rest day
  is *part of* the streak. A span of **calendar days**.
- `lib/achievements.ts` does `streak++` once per dated entry — rest days bridge the gap without
  being counted. A count of **sessions**.

Replayed against the owner's real history (103 trained days, 2026-05-01 → 2026-09-26):

| | value |
|---|---|
| Home — calendar days, gap 2 | **111** |
| achievements — sessions, gap 2 | 83 |
| achievements — sessions, gap 1 (`maxCompliantRestGapFor` for a rotation) | **49** ← the reported figure |

So both reported numbers reproduce exactly, and **neither was arithmetically wrong**. 83 sessions
spanning 111 calendar days is just true. What was wrong is that both were labelled "streak" and
put on screens he compares.

## Which reading wins, and why it was not a coin toss

**Calendar days**, because three things written before this already say so: Home's card reads
"STREAK … days"; the four streak achievements read "7-day / 14-day / 30-day / 60-day training
streak"; and the StreakCard banner tells the user two rest days keep a streak and the third breaks
it. The session count contradicted all three while sitting next to them.

## The rest gap is a FLOOR, and that is the part I got wrong first

My first pass set a flat gap of 2 everywhere. That would have regressed **BF-122a**, whose comment
is in the file and says exactly why: someone training Mon+Tue has a five-day hole and is following
their plan through all of it — a literal 1 broke their streak every week, and a 2 would too.

But `maxCompliantRestGapFor` alone returns **1** for a rotation, which is what produced the 49
against a banner promising two rest days.

`streakRestGapFor` is `Math.max(2, maxCompliantRestGapFor(schedule))` and satisfies both: a
rotation gets 2 (the promise), Mon+Tue still gets 5 (BF-122a), and a user with no schedule gets 2
rather than the old 1. The floor is the app's promise; the max is BF-122a.

## A third thing the entry does not mention

`lib/achievements.ts`'s function is not only the workout streak — **food, sleep and calorie-goal
streaks use it too**, at gap 0, where counting dated entries is correct ("log food 7 days in a
row" means seven entries). A wholesale swap would have silently changed all three. It keeps its
behaviour and is renamed **`computeEntryStreak`**, so the two metrics can never share a name
again.

## What the mutation pass caught

Five mutants, one control. Four died immediately; **the most important one survived**, and the
reason is worth keeping.

| mutation | killed |
|---|---|
| count sessions instead of calendar days | **0 → 1** |
| drop the floor (`maxCompliantRestGapFor` alone) | 2 |
| floor becomes a ceiling (regresses BF-122a) | 3 |
| measure `current` to the last trained day, not to today | 1 |
| `best` ignores the current span | 1 |
| **control:** name the sorted list in a const first | **0 — survived, as intended** |

Counting sessions instead of days passed the whole file. The assertion meant to catch it was on a
streak running up to today, and `return { best: Math.max(best, current) }` handed back the
day-counted `current`, masking a session-counted `best`. The case that separates them is a **past**
best longer than the present one. Added — and its first fixture was wrong too (7 → 11 is three
rest days, which breaks at gap 2, so it read 7 rather than 11), which the test caught before it
was trusted.

## Verification

Equivalence proven rather than asserted: `computeDayStreak` returns **111** on the owner's real
history — Home's exact number — with best ≥ current. Run against Home's live implementation, not
a reimplementation of it.

Lint 0 errors; `tsc` clean; Custom Rules **80 of 80**; full suite **1,107 files, 10,353 passed / 87 skipped, EXIT=0**.

On the dev server: `GET /api/achievements` **200** with `bestStreak: 17`, and
`GET /api/friends/leaderboard` **200** with `allTimeStreak: 17` — the two agreeing is the point.

## Not exercised

**No screen was rendered and no device was used.** The numbers were read out of the two API
routes, not off Home or More.

**Home still holds its own copy.** The shared function was written to be behaviourally identical
to it, so nothing on Home changes today; the import swap is `LA-156`, which is Lane B's per the
entry's own split. Until then Home cannot read the schedule, so a *weekly* user will see Home
under-report against the achievements page. The owner is on a rotation, where the floor is what
applies, so he sees 111 on both.

**This raises his best streak from 49 to 111 and awards "Iron Will" (60-day).** That is the
change being made, not a side effect — but it is a number he reads, so it is worth saying plainly.
Reversal is one constant.
