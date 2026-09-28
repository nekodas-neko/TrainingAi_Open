# 2026-09-28 — LA-137: a guard that runs the pull instead of parsing it

`applyDelta` writes every column it lists, so a field the server's select or the client's mapper
loses is overwritten with NULL on every pull. RV-172 found three and shipped a guard pinned to
those. The general source parser was withdrawn for false positives: nested template literals,
bleeding statement bounds, two upserts per table, and junk snake→camel names.

This guard parses no TypeScript. It generates one server row per delta table with every column
set, reading `information_schema` and creating a parent row for each foreign key; programs →
phase_sets → programs is broken at its nullable edge. It then runs the client's real `pullDelta`
against the real `/api/sync/pull` handler, into the real local schema on `node:sqlite`. From the
statements that actually executed, it reads each column's bound value. NULL, false, 0, NaN or
`'undefined'` mean the field was lost; the fixture never uses those values. It covers all 30 local
tables, the `INSERT OR REPLACE` program tables included.

**It found two, both fixed here:**
- `workout_sessions.session_id` is sent as `programSessionId` (the Drizzle property). The mapper
  read `sessionId`, so every pull NULLed the device's workout→program-session link. Q-131's fix
  had read the same wrong key.
- `day_checkins.food_logging_completed_at` was never mapped, so another device's completion never
  arrived.

Mutation pass, each mutant named by the guard: a select dropping `barcode`, both fixes reverted,
RV-172's coerced `exercise_deloaded`, and a dropped `taken_at`. Control green.

**It deviates from the entry's "Custom Rules step".** It needs Postgres and `node_modules`, so it
runs in `Tests`, where it can execute the code instead of reading it.
