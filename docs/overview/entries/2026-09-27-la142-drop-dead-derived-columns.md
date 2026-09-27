# LA-142 — four dead columns out of `oura_daily_derived`, and the migration that would have failed

**Branch:** `lane-a/la142-drop-dead-derived-columns` · **Lane A** · Postgres **286** + `claude_ro`
twin **287** · local SQLite **v42** · ⚠ **data-dropping: not self-merged**

## The claim, verified twice

`active_calories_est`, `pwv`, `worn_hours_ble` and the **derived** `vascular_age` have no writer
and no reader. Production on 2026-09-27: **132 rows, 0 non-null in each of the four.** Nothing is
lost; this removes dead weight from the ~40-field sync payload.

**The conflation trap the entry warns about is real, and confirmed from a second direction.**
`oura_daily.vascular_age` is a different table, IS written, and IS rendered —
`getLatestOuraCloudVitals` supplies it to the UI as a deliberate stale surface ("as of
`cloudVitalsDate`"), which TN-37's own correction records. Only `schema.ts:1745/1755/1782/1783`
go; `schema.ts:1334` stays. A bare grep returns 131 hits for `vascular_age` and cannot tell them
apart.

## Running the migration is what caught the defect in it

The first draft was four `ALTER TABLE … DROP COLUMN IF EXISTS`. Applied to the local database it
failed **four times**:

```
ERROR: cannot drop column active_calories_est of table oura_daily_derived
       because other objects depend on it
DETAIL: view claude_ro.oura_daily_derived depends on column active_calories_est
```

The `claude_ro` view SELECTs all four by name. **This migration would have failed on production
and left the table untouched**, and nothing about reading it says so. `DROP VIEW IF EXISTS
claude_ro.oura_daily_derived;` now leads the file; the twin recreates it two migrations later, in
the same deploy.

A second trap in the same run: `psql` without `ON_ERROR_STOP=1` **exits 0** after per-statement
errors, so the first attempt printed a success line. The column count is what said otherwise —
still 8 (4 table + 4 view) rather than 0.

## The twin is generated from a live database, not from `schema.ts`

`generate-claude-ro-views.js` reads `information_schema`, so regenerating before applying 286
produced a file **byte-identical to the previous twin** — a plausible-looking no-op. Apply the
migration first, then generate. After that the diff against 285 is exactly the four lines and
nothing else, across 98 views, with the owner's uuid absent (Q-456).

## Verification

`tsc` clean; the two `claude_ro` tests over a **TCP** URL — **2 files, 27 tests, none skipped**,
matching what CLAUDE.md says to expect; local-store/sqlite/sync suites **276 passed**; full suite
**1,108 files, 10,358 passed / 87 skipped, EXIT=0**; Custom Rules **80 of 80**.

**Two positional guards earned their place.** `sqlite-backend.test.ts` asserts
`params[12] === 1` for `training_load_high` — an index, deliberately not made robust, because it
proves the value list still lines up with the column list. Removing `active_calories_est` from
earlier in that list pulled it from 13 to 12, and the test failed exactly as designed. And
`migrations.test.ts`'s **2026-07-23 outage guard** lost three names — noted in place that a name
leaves that list only when its column leaves the schema, never because the assertion is
inconvenient.

## Why this is not self-merged

A `DROP COLUMN` is a data-dropping migration, which CLAUDE.md puts in the confirm-first carve-out
regardless of whether it happens to drop data. Here it drops none — every value is NULL — and the
reversal is a corrective migration re-adding four nullable columns, which restores the exact prior
state because there is no data to restore. Still yours to say yes to.

## Not exercised

**No device.** Local SQLite v42 uses `DROP COLUMN`, which SQLite has supported since 3.35 and
Android's bundled build is well past — but the upgrade path was not run on the phone, and unlike
an `ADD COLUMN` there is no `IF EXISTS` form, so a half-applied v42 would throw on retry. The
RECONCILE rows are gone, so nothing re-adds the columns behind it.

**Production was read, never written.** The migration ran against the local database only.
