# 2026-09-30 — BF-203a Task 2: the local store can hold an estimate

**Branch:** `feat/bf203a-local-estimate-columns` · **Lane A** · local SQLite v45, shipped alone.

The six `est_*` columns from Postgres migration `202609292220` are now in `CREATE_PLAN_MEAL_ANSWERS`
for fresh installs, in v45's `ALTER`s for installed devices, and in `RECONCILE_COLUMNS` in case the
version half-applies. Nothing writes or reads them on the device yet: the pull mapper and
`applyDelta` gain them when the materialiser lands.

**Verified:** `migrations.test.ts` (v45 ceiling, plus a three-part test for every column), 290 local
store tests, and `check:rules` (84 of 84).

**Not exercised:** an upgrade on the APK. v45 is ALTER-only and matches the shape of v44, which has
been upgraded on device.
