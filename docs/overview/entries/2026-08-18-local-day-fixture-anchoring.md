# 2026-08-18 — the test that broke every branch for two hours a day (Q-356)

**Lane A** · branch `fix/periodization-soft-delete-local-midnight` · tests only, no production code,
no migration, no Kotlin, no APK.

`periodization-soft-delete.test.ts` failed between **14:00 and 16:00 UTC, on every branch**. It was
not specific to whatever PR happened to be open when it fired — it blocked merges repo-wide for two
hours a day.

## The mechanism

The fixture inserted a session at `now() - interval '2 hours'` — a **UTC** offset — and then derived
the query window from the **user's** timezone:

```sql
SELECT to_char((now() AT TIME ZONE 'Australia/Brisbane')::date, 'YYYY-MM-DD') AS today
```

`getWeeklySetsByMuscleGroup` filters on `ws.started_at`. Between 00:00 and 02:00 Brisbane —
14:00–16:00 UTC — "two hours ago" is the **previous** Brisbane day, so the session fell outside
`[today, today]` and the count came back zero.

The comment above the insert asserted the opposite — *"Started an hour ago so the session sits inside
today's user-local week regardless of the hour the suite runs at"* — which was true for twenty-two
hours a day and false for two. It has been corrected along with the code.

**One correction to the entry:** it said "all five assertions fail". Measured here, the whole file
goes red — **21 of 21**.

## The fix

Compute the user-local day **first**, then anchor the session to **midday on that day**, so both
sides of the comparison come from the same date by construction. Midday rather than midnight because
a boundary is where an off-by-one in either direction stops being visible; this leaves twelve hours
of slack on each side.

This is the rule `CLAUDE.md` already states — *"derive the fixture from the clock or inject the clock
— never hardcode one side of a rolling window"* — in the shape it did not yet name: **both sides
derived, but from different timezones.**

## The regression test has no window, on purpose

The bug survived for weeks *because* it only fired for two hours. A test that waits for that window
would inherit the same weakness, and `faketime` is no help — it shifts node's clock but not
Postgres's, and every clock in this test comes from Postgres.

So `local-day-fixture-anchoring.test.ts` **constructs the hazard** instead: it picks a fixed-offset
zone (`Etc/GMT±N`) whose local time is right now about 01:00, and runs the failing case there. That
exercises it on every CI run, at any hour. Fixed offsets rather than a named city so the zone cannot
drift into or out of DST and quietly stop reproducing anything.

Four assertions: the chosen zone really is in its 00:00–02:00 band; the old UTC-offset anchor lands
on a **different day** (the bug, demonstrated rather than described); the local-midday anchor lands
inside the window; and it keeps ≥11 hours of margin from both edges.

## Verified by reproducing the outage

Not argued — reproduced. Pointing the real test at the failure-band zone (`Etc/GMT+4` at the time of
running) with the **old** anchoring gives **21 failed / 21**; with the **new** anchoring, in the same
zone, **21 passed**. Then back to Brisbane: 21 passed.

## The sweep

The entry asked for one: *"any other test inserting `now() - interval '…'` and querying a user-local
day window has this exact hole."* Twelve files use `now() - interval`. Checked each:

- **`oura-workout-soft-delete.test.ts` is the closest twin** — same `now() - interval '2 hours'`,
  same shape — and is **immune**, because it reads the local day **back from the row it just
  inserted** (`SELECT … FROM workout_sessions WHERE id = $1`) rather than from the clock. Both sides
  come from the same instant. That is the other correct pattern, and worth knowing as a second
  option.
- The rest use `now() - interval` for **retention** windows (thread/meal-plan/sample age), which
  compare a UTC instant against a UTC interval and never involve a user-local day.

**One instance, now fixed.** No further hits.

## Failure surfaces NOT exercised

- **No production code changed.** This is a test-fixture defect; nothing about the app's behaviour is
  affected either way.
- **DST-observing zones are not exercised** — deliberately, since the regression test uses fixed
  offsets so it cannot drift. A zone with a midnight DST transition would be a different hazard, and
  is not one this repo's data hits.

## Also in this PR: the compaction sweep, and what it taught

`docs/overview/entries/` hit **61 files** against its 60-file runaway limit, which fails
`pnpm check:rules` — so it was blocking every branch, exactly like the bug above. Swept here because
leaving it red would have blocked the fix for the thing that was blocking everything.

The sweep as the README described it does not work, and failed CI twice before it did:

1. **Folding every entry broke 48 links.** Durable docs cite entries by path — `projectOverview.md`
   Known-Issues rows, domain READMEs, and both agent batons. Rewriting another lane's baton to chase
   a tidy-up is not something a sweep should do, so only the **29 entries nothing links to** were
   folded. 61 → 32: under the limit, no link touched.
2. **Relative links inside a folded body lose a level.** An entry lives in
   `docs/overview/entries/`; the history file is one level up. `](../../x)` becomes `](../x)`.
   Missing that left 6 links pointing one directory too high.

Both are now in `docs/overview/entries/README.md`, along with the tension neither the README nor
this PR resolves: **fold-everything and durable-docs-linking-entries are incompatible**, so the loose
directory has a floor that grows. Fixing it properly means either the sweep rewriting citations to
the history file it folded into (with an anchor), or durable docs citing the batched history rather
than a loose entry. Recorded, not decided.

