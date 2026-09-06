# Review sweep 48 — the id guard reaches every path parameter and no request body

**Date:** 2026-09-05 · **Agent:** 📖 Review · **Branch:** `claude/review-agent-sweep-48` · Docs only.

The baton's next lens: whether a 2xx means what it says beyond `DELETE`. Sweep 47 did the delete
surface; this asked the same of every `PUT`/`PATCH`.

**Where the id is a path parameter, the update surface is sound.** All thirteen dynamic routes answer
`404` for a well-formed id that does not exist, and refuse the second account's row with the row read
back unchanged. That makes sweep 47's finding a `DELETE` finding rather than a general one.

**Where the id arrives in the body, it is not.** `invalidUuidResponse` — Q-482's guard — is applied to
**27 of 27** dynamic `[id]` routes and **zero** body-id ones. `PATCH /api/admin/exercises` answers
`500` for `not-a-uuid` and `404` for a well-formed missing id: one route, one payload, one field
differing only in format. `PATCH /api/admin/users` and `PATCH /api/nutrition/meal-types` answer `500`
with an **empty body**. All three file the raw failing statement into `error_events`
(`[pg 22P02] Failed query: update "users" set "is_active" = $1 …`). The response bodies are safe, so
this is Q-482's status half, not Q-483. **The fix is already written in `PATCH /api/workout-entry`** —
`.uuid()` on the id field of the Zod schema these routes already have (RV-47).

**RV-48:** three routes answer `200 {"ok":true}` for an update that matched nothing, each measured
against a positive control where the same response follows a write that did change the database —
deactivating a real user flips `is_active`, reordering real ids moves `sort_order`. Sibling of RV-45,
filed separately because the cause differs: the delete routes discard an affected-row count they
could return, these never ask for one.

**Three surfaces the baton listed as *unverified, not clean* are now verified.**
`PATCH /api/activity-logs/[id]/metrics` cross-user: owner writes 42 and the column reads 42, the
second account sends the same shape and gets `404` with the column still 42. RV-40's two:
`complete-workout` answers `400` on a malformed session id and `404` on a well-formed missing one;
`log-exercise` answers `400` naming the field. **And `CLAUDE.md`'s ownership-rule-(c) claim is true** —
the second account posting a `log-exercise` at the first's `workoutSessionId` got `404`, with no log
attached and no session created.

**Recorded clean, and nearly filed as a bug:** `PUT /api/nutrition/saved-meals/[id]` answers `200` for
an id that does not exist and writes a row at the client's UUID, which reads like the write-path
ownership class until `writeSavedMeal` is read. It is a deliberate upsert with
`onConflictDoUpdate({ setWhere: eq(userId) })`, shared by create and update so an offline device can
mint its own ids — and it refused the second account's id with the row unchanged.

**Five of the first thirteen probes never reached the handler**, each rejected on a different field
than the one under test: a `distanceKm` of 999 against a schema capped at 500, a wrong key, a status
outside its enum. Every result above is from a re-probe whose control fired correctly.

**Not exercised:** the device. `oura_workouts` holds 0 rows locally, so the positive control for
`PATCH /api/oura/workouts` could not be built — its `200`-for-a-ghost is measured, the rest read from
source. No production data was read.

Write-up:
[`docs/reviews/2026-09-05-body-supplied-ids-skip-the-guard.md`](../../reviews/2026-09-05-body-supplied-ids-skip-the-guard.md).
