# The id guard reaches every path parameter and no request body

**Date:** 2026-09-05 · **Agent:** Review 📖 (sweep 48) · **Pillars:** `[platform]` `[nutrition]`
**Lens:** the baton's next item — whether a 2xx means what it says beyond `DELETE`. Sweep 47 did the
delete surface; this asks the same question of every `PUT`/`PATCH`.

**The update surface is sound where the id is a path parameter.** All thirteen dynamic `PUT`/`PATCH`
routes answer `404` for a well-formed id that does not exist, and refuse another account's row with
the row unchanged. That is the opposite of sweep 47's delete result, and it means that finding is
specific to `DELETE` rather than a general "a 2xx means nothing" problem.

**It is not sound where the id arrives in the body.** `invalidUuidResponse` — the guard Q-482 added
after 21 route/method pairs answered 5xx on a malformed id — is applied to **27 of 27** dynamic
`[id]` routes and **zero** body-id routes. Three of them still answer `500` on a malformed id, two
with an empty body, each filing the raw failing statement into `error_events`. Three answer
`200 {"ok":true}` for an update that matched nothing.

---

## 1. Method, and what it does not establish

Run against `pnpm dev` on the seeded local Postgres with two signed-in accounts. Every probe is
paired with a control, and every write is read back out of Postgres:

- **Malformed id (`not-a-uuid`) against well-formed-but-nonexistent.** On one route these are the
  control for each other: same payload, one field differing only in *format*, so two different
  statuses means one of them is wrong.
- **A positive control for every "reports success" claim.** A route answering `200 {"ok":true}` to a
  ghost id proves nothing until the same call with a real id is shown to change the database.
- **Cross-account**: the second account sends the first's row id, and the row is read back after.

**Five of my first thirteen probes never reached the handler**, each rejected on a different field
than the one under test — a `distanceKm` of 999 against a schema capped at 500, a wrong key name, a
`status` outside its enum. Every result below is from a re-probe whose control fired correctly.

**Re-verified after the merge.** LA-58 (*"make the deactivation gate cover API routes"*) landed on
`main` between the probes and this PR, changing gating on the routes measured here. Every result in
§2 and §3 was re-run against the merged tree and is unchanged.

**What this does not establish.** `oura_workouts` holds **0 rows** locally, so the positive control
for `PATCH /api/oura/workouts` could not be built: its `200`-for-a-ghost is measured, but "the same
response also means a real write" is read from source, not observed. This is the **web** build —
nothing native, safe-area or Samsung-WebView is in scope. No production data was read.

## 2. RV-47 — a malformed id in the body reaches the driver

| Route | malformed body id | well-formed, missing |
|---|---|---|
| `PATCH /api/admin/exercises` | **`500` "Update failed"** | `404 Exercise not found` |
| `PATCH /api/nutrition/meal-types` (reorder) | **`500`, empty body** | `200 {"ok":true}` |
| `PATCH /api/admin/users` | **`500`, empty body** | `200 {"ok":true}` |
| `PATCH /api/workout-entry` | `400 Invalid body` | `404 Not found` | ✅ |

The first row is self-controlling: the same route, the same payload, one field differing only in
format, answering `500` and `404`. That is Q-482's class exactly — *"a malformed id 500s while a
valid-but-missing one answers correctly"* — on the surface Q-482 did not cover.

All three 500s file the failing statement into `error_events`:

```
PATCH /api/admin/users        | [pg 22P02] Failed query: update "users" set "is_active" = $1 where "users"."id" = $2
PATCH /api/nutrition/meal-types | [pg 22P02] Failed query: update "meal_types" set "sort_order" = $1 where …
     /api/admin/exercises     | [pg 22P02] Failed query: select "id", "name", "muscles", "equipment", "instructions", "created_by", …
```

The response bodies are safe — `admin/exercises` answers the generic "Update failed" — so this is
not Q-483's raw-error-to-the-client defect. It is the status half, plus the same `error_events`
pollution RV-46 records: a malformed request logged as a server fault. Two of the three return an
**empty** body, the symptom `lib/api/route-errors.ts` names in its own header, where a client
calling `res.json()` throws a parse exception on top of the failure.

**`PATCH /api/workout-entry` is the fix, already written.** It puts `.uuid()` on `exerciseLogId` in
its Zod schema, so a malformed id is a `400` before any query runs. One word per route, in the
schema these routes already have.

## 3. RV-48 — an update that matched nothing reports success

Each with a positive control showing the *same* response after a write that did change the database:

| Route | ghost id | positive control |
|---|---|---|
| `PATCH /api/admin/users` | `200 {"ok":true}`, nothing changed | real id + `deactivate` → `200`, `is_active` flips to `f` |
| `PATCH /api/nutrition/meal-types` (reorder) | `200 {"ok":true}`, order unchanged | real ids → `200`, Lunch moves from `sort_order` 2 to 0 |
| `PATCH /api/oura/workouts` | `200 {"ok":true}` | **not established** — 0 rows locally |

`markOuraWorkoutReviewed` returns `Promise<void>` and the route returns `{ ok: true }`
unconditionally (`app/api/oura/workouts/route.ts`), so nothing can distinguish the two cases from
the response. It also has no id-format guard and no not-found path at all — the only route of the
five with neither.

This is sweep 47's `DELETE` class on the update surface. It is filed separately because the cause is
different: the delete routes discard an affected-row count they could have returned, while these
never ask for one.

## 4. Clean, recorded as results

- **Every dynamic `PUT`/`PATCH` answers `404` for a ghost id.** Thirteen routes: `supplements`,
  `injuries`, `food-logs`, `meal-types`, `phase-sets`, `nutrition-goals`, `meal-plans`,
  `meal-plans/structure`, `meal-plans/meals`, `running-plan/runs`, `friends`,
  `activity-logs/metrics`, and `saved-meals` (below). Sweep 47's finding is a `DELETE` finding.
- **`PUT /api/nutrition/saved-meals/[id]` creating a row is correct, not a defect.** It answers
  `200` for an id that does not exist and writes a row at the client's UUID — which reads like the
  ownership-rule-(a) class until `writeSavedMeal` is read. It is a deliberate upsert with
  `onConflictDoUpdate({ setWhere: eq(userId) })`, shared by create and update so an offline client
  can generate its own id. The second account sending the first's saved-meal id got
  `404 Saved meal not found` with the row unchanged.
- **`PATCH /api/activity-logs/[id]/metrics` is verified cross-user** — one of the three surfaces the
  baton listed as *unverified, not clean*. Owner sends `{"distanceKm":42}` → `200`, and the column
  reads 42; the second account sends the same shape at the same row → `404`, column still 42.
- **RV-40's two remaining surfaces are verified.** `POST /api/complete-workout` answers
  `400 Invalid request` on a malformed session id and `404 Session not found` on a well-formed
  missing one. `POST /api/log-exercise` answers `400` naming the field
  (`{"workoutSessionId":["Invalid UUID"]}`).
- **`CLAUDE.md`'s ownership-rule-(c) reference claim is true.** The rule cites `ensureWorkoutSession`
  as the pattern for verifying a client-supplied id against its owning table. The second account
  posting a `log-exercise` at the first's `workoutSessionId` got `404 Workout session not found`; no
  log attached to that session, and no session created for the caller.

## 5. Filed

| ID | Pillar | What |
|---|---|---|
| **RV-47** | `[platform]` `[nutrition]` | `invalidUuidResponse` reaches 27 of 27 path-id routes and 0 body-id ones; three answer `500` on a malformed id, two with empty bodies, each logging the raw `22P02` statement. `workout-entry`'s `.uuid()` is the one-word fix |
| **RV-48** | `[platform]` | Three routes answer `200 {"ok":true}` for an update that matched nothing, each proven against a positive control where the same response means a real write |

## 6. Method notes

- **A malformed id and a well-formed missing one are each other's control**, on one route with one
  payload. Two different statuses for two ids differing only in format means one is wrong, and no
  fixture is needed to show it.
- **"Reports success" needs a positive control or it is not a finding.** `200 {"ok":true}` for a
  ghost id says nothing until the same call with a real id is shown to move the database. Where the
  table was empty (`oura_workouts`) the claim is written as **not established** rather than dropped
  or asserted.
- **Five of thirteen first probes were rejected on a field other than the one under test** — a value
  over its `max()`, a wrong key, a status outside its enum. The tell is that the *control* returns
  the same error as the probe: two identical failures are two failed probes, not a result.
- **Check whether a create-on-update is the offline-first design before filing it.** `saved-meals`
  writing a row at a client-supplied id looks like the write-path ownership class and is the
  opposite: one shared upsert, `setWhere` on the owner, so a device can mint its own ids offline.
