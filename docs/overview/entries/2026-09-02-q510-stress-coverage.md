## 2026-09-02 — the number that says why resilience produced nothing (Q-510, first action)

**Branch:** `claude/la-q510` · **Lane:** A · **Migrations 256 + 257.** Additive and nullable; nothing
reads the column yet.

### The gap

`final_check_stress_coverage` decides whether a day contributes a resilience index:

```
resolutionMinutes × nonNaN_resampled_buckets  >=  minDaytimeStressHours × 60
```

**Neither side was stored anywhere.** `minDaytimeStressHours` is a vendored constant, and the bucket
count was computed inside `preprocessStress` and thrown away one line later. Measured 2026-08-18: a
daily index landed on **3 of 18 days** while all four `contributorsOk` inputs passed on every one of
them — and nothing in the database could say why the other fifteen produced nothing. The stored
extreme-bucket counts cannot stand in: 08-07, 08-13 and 08-17 each carry 90 minutes of extremes and
produce no index, while 08-16 carries the same 90 and does.

### What shipped

`preprocessStress` now returns the count it already had; `runStressResilience` surfaces it as minutes
on **every** branch including the failing one; and `oura_daily_derived.daytime_stress_coverage_min`
stores it. Migration **257** regenerates the `claude_ro` views — without it the column is invisible to
`/api/admin/db-query`, which is the only way anyone reads production data here, and the column exists
precisely to be read that way.

### Two decisions worth stating

**NULL means NOT EVALUATED, not zero coverage.** When a contributor is missing, `computeResilienceForDay`
deliberately feeds the model an empty stress series — so a 0 there would be an artefact of that
gating, and would send a later auditor after the coverage gate when the real cause was a missing
contributor. A number is always a real measurement of the day's own series.

**The entry did not mention the write condition, and it mattered.** The resilience upsert was guarded
by `if (res.dailyIndices || res.level != null)` — so a day producing neither wrote *nothing at all*.
That is exactly the day this number explains. Persisting the value without widening that guard would
have shipped a column that stays NULL on every row it was built for.

### Verification, and why the tests are written the way they are

The existing orchestrator suite is `skipIf(!hasRealConstants())` — those constants left the tree, so
it skips here and in CI. **Adding tests there would have meant shipping this unexercised**, so the new
ones inject a synthetic constant set through `setResilienceConstants` and assert *relative* behaviour:
a shorter series yields a smaller number, an empty one yields 0, a missing contributor yields null.
They run everywhere.

**Mutation-tested.** Reporting 0 instead of null on a missing contributor fails 1 of 4; dropping the
coverage entirely fails 2 of 4; restored, all pass. The file went from 3 passing to 7.

`tsc` clean, `pnpm check:rules` 67 of 67, both migrations apply to the local dev database.

**Local SQLite v35 is NOT device-verified**, and it lands on top of v34 which is not either (BF-69's
`supplement_logs` rebuild). v35 is a plain `ADD COLUMN` — no rebuild, nothing dropped — so it is the
mildest kind of local migration, but it has still never opened on the S25.

**Not verified on production data** either — the column is empty until the rollup next runs there, and
this session has read-only access.

### The chain was wider than the entry implied, and a guard caught it

The entry asks to "persist the coverage on the derived row". `DERIVED_COLS` in `slices/oura.ts` is
`Record<keyof OuraDailyDerivedPatch, string>`, and a test asserts **every** key of it appears in the
offline-sync push payload — with a comment naming this exact bug class: *"a new column added here
without updating the pushMutations branch would otherwise never back up."* It went red immediately.

So the column rides the whole chain: Postgres 256/257, local SQLite **v35** plus a `RECONCILE_COLUMNS`
row, the local record type, both local upserts (column list, placeholder count, bound values and the
`ON CONFLICT` list — none of which TypeScript can check, since they are SQL strings), the pull mapper
and two test fixtures. Column/placeholder parity was checked mechanically on both upserts rather than
by eye.

### What is still owed

`worn_hours_ble` is **0 of 107 rows** (0 of 96 when the entry was filed, 0 of 79 in the 2026-08-05
review). The entry says "populate it or drop the column". Populating needs a source and dropping is
destructive, so it stays on the entry for the owner rather than being decided here. And whether
`minDaytimeStressHours` is too strict is Tuning's question — which cannot be asked until real coverage
numbers accumulate, and must not be answered by lowering the constant until the score fires.
