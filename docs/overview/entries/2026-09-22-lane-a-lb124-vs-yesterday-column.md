# 2026-09-22 — Lane A · LB-124: the column TN-58's control writes to

TN-58 asks *"is today better or worse than yesterday?"* instead of an absolute 1–5, because the
absolute scale produced **two distinct values in 81 days**. Lane B took it off READY, found the
field did not exist anywhere, and filed this rather than attempting it. The reason that mattered:
`Body` in `app/api/day-checkin/route.ts` is not `.strict()`, so Zod **strips** an unknown key rather
than rejecting it — a sheet posting `vsYesterday` would have got **201 and written nothing**. A
control that looks like it works and stores nothing would have burned TN-58's two-week pass test and
reported "no self-report available from this owner" when the truth was a dropped field.

## What shipped

`day_checkins.vs_yesterday text`, nullable, **no default** — migration **280**, `claude_ro` twin
**281**, local SQLite **v40**. Carried end to end: the Drizzle schema, the shared `DayCheckin` type,
the Zod schema, the route, `saveDayCheckin`'s insert and its `ON CONFLICT` set, **all three** row
mappers, `pushMutations`, the local table (CREATE body + ALTER + `RECONCILE_COLUMNS`), the local
upsert, the local read, and the pull-delta.

## The type choice, which the entry left to build time

Text enum, not a signed integer. Both were open and the entry named the trade (*"the integer is
easier for TN-33 to correlate and the enum is harder to misread"*). **This table decides it:** every
other scale here stores **1 = best … 5 = worst**, a direction the codebase has to keep restating —
`build-day-audit.ts` carries *"Stored 1 = slept great … 5 = terrible (the on-screen selector
reverses this)"*. A `-1/0/+1` column where +1 means BETTER puts the opposite polarity in the same
row as those, which is the misreading LB-124 warns about. `illness_context` already stores a text
enum on this table, so this follows a shape proven here rather than adding a second convention.
TN-33 gets its number from one shared mapping at read time, not from the storage.

## NULL is the point, so there is no default

The bug TN-57 fixed *this morning* is a neutral value stored as though it were an answer. A default
here would recreate it on the very question meant to escape it. This control needs no `*_touched`
twin either, and that is a property of the question rather than an omission: unlike a slider seeded
at the midpoint, there is no position to accept by leaving it alone — not answering is simply
absence.

## Two things the compiler found that no test would have

1. **`app/api/food-logging-complete/route.ts` re-saves the evening row** to flip one flag, and
   `saveDayCheckin` overwrites every column it is given a value for. A route that omitted
   `vsYesterday` would have **cleared the answer every time the food log was marked complete** —
   silently, and only on days the lifter had answered. Making `DayCheckin.vsYesterday` required
   rather than optional is what surfaced it; there is now a test.
2. **Three row mappers, not two.** `getDayCheckin`, `listDayCheckins` and `saveDayCheckin`'s own
   return. An assertion on the count caught the third.

## The claude_ro twin, and the trap in generating it

The generator reads the **live database**, not the migration files. Running it before applying 280
locally produced a file byte-identical to 279's body — the column did not exist yet, so it could not
be listed, and the "regenerate the twin" step silently produced a no-op that would have shipped.
**Apply the column migration first, then generate, then diff.** Done in that order the file differs
from 279 by exactly one line, `t.vs_yesterday`, and the owner's id does not appear (Q-456).

`claude-ro-readonly-role.test.ts` and `db-snapshot-integration.test.ts` were run over the **TCP**
URL, as the rule requires: **2 files, 27 tests, all passed, none skipped.** On the socket URL that
`scripts/local-db/setup.sh` writes they skip and say nothing.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**. It caught the live-pointer table still reading migration
  280 / SQLite v39.
- Full suite — **9,366 tests / 990 files**, green. `check-test-typecheck` none above baseline after
  a fixture gained the field.
- **Mutation pass: 6 caught, 2 equivalent controls passed.** The caught ones: dropping
  `vsYesterday` from `dayCheckinHasAnswers` (a check-in whose only answer is this one would 400),
  from the adapter insert, from `pushMutations` (web/outbox divergence), from
  `food-logging-complete` (the erase trap), removing the v40 ALTER (fresh installs fine, every
  upgraded device broken), and dropping one placeholder from the local upsert — which
  `insert-arity.test.ts` catches, and which is otherwise an on-device-only runtime error.
  **One intended control was not equivalent and that is worth recording:** adding whitespace inside
  the ALTER string failed, because the sibling assertions in `migrations.test.ts` match the DDL text
  exactly. The convention is stricter than it looks.
- **`pnpm dev` against the local database.** `vsYesterday: "worse"` POSTed and read back as `'worse'`
  through the GET mapper; a skipped day stored and read back **NULL**; `"much better"` answered
  **400** rather than being stripped to a silent 201; and the value was visible through
  `claude_ro.day_checkins`, which is what the twin exists for.

## Not exercised

The local SQLite path is **not executed anywhere** — `getLocalStore` returns null off the APK, so no
test in this sandbox can run those statements. That is exactly why `insert-arity.test.ts` is a
source-text check, and it is the guard that covers the change here. The v40 upgrade itself lands on
the device at next launch and has not been observed there.

## Deliberately not done

`Body` is still not `.strict()`. Making it strict would fix the silent-strip hazard for the *next*
field as well, but it would also start rejecting bodies that currently succeed with extra keys, and
that is a behaviour change well outside this entry. Filed as a note here rather than smuggled in:
**the hazard is closed for `vsYesterday` because the key is now known, not because the shape
changed.**
