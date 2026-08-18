# Review — what a dynamic route does with an id that is not a UUID

**Date:** 2026-08-18 · **Agent:** Review · **Lens:** route-parameter validation
**Findings filed:** Q-482, Q-483 · **Clean results recorded:** two

## Why this lens

Earlier sweeps probed dynamic routes with **another user's** id (protection holds) and with a
**valid-but-missing** id (Q-463, the not-found answer). Neither covered the third case: an id that is
not a UUID at all. Postgres rejects it at cast time with `22P02 invalid_text_representation`, so the
question is whether the route validates first or hands it to the driver.

Method: every one of the 30 dynamic route files, every method, called twice — once with a
well-formed-but-nonexistent UUID (**the control**) and once with `not-a-uuid`. 39 route/method pairs.

**Reading the table:** a **500 is always conclusive** — the request reached the database. A **400 is
not**: for PATCH/PUT/POST the probe sent `{}`, so the body schema may have rejected it before the id
was ever used. Only the GET and DELETE rows prove correct id handling.

---

## Finding 1 (Q-483) — three routes return the raw driver error, including the full SQL

This is the smaller finding and the more serious one.

```
GET /api/workout-sessions/not-a-uuid/recap   →  500
{"error":"[ERROR]: Error: Failed query: select \"id\", \"user_id\", \"session_id\",
 \"session_name\", \"started_at\", \"completed_at\", \"hr_synced_at\", \"warmup_ended_at\",
 \"phase_id\", \"phase_type\", \"is_early_deload\", \"was_override\", \"intensity_mode\", …
```

The control returns `{"error":"Not found"}` with a 404, so this is specific to the malformed id.

The response body is the stringified driver error — the complete `SELECT`, every column name of
`workout_sessions`. It comes from the route's **own** catch, not Next's dev overlay:

```ts
const errMsg = errorLog(error, 'GET /api/workout-sessions/[id]/recap')
return NextResponse.json({ error: errMsg }, { status: 500 })
```

and `errorLog` (`packages/shared/src/logger.ts:1`) does `` `${logPrefix} ${error}` `` and returns it —
**no environment check, no redaction**. So this ships to the client in production exactly as it does
here.

**Scope, measured precisely:** four routes use `error: errMsg` / `error: errorLog(...)` as the
response body — `workout-sessions/[id]/{recap,energy,timing}` and `session-explain/insight`. The three
`workout-sessions` routes leak. **`session-explain/insight` does not today** — a malformed
`sessionId` returns a clean `404 {"error":"No AI dynamic recommendation available"}` because it is
guarded upstream — but it carries the same pattern and would leak the moment an error reached its
catch.

**What it is and is not.** It is schema disclosure to an *authenticated* user, and this app's users
are its own account holders — so it is not an anonymous-attacker hole. It is still worth fixing: it
publishes table structure that nothing else exposes, it does it in a JSON field a client may render,
and the fix is to send a fixed string and keep the detail in the log. `reportServerError` is already
called on the line above, so nothing is lost by redacting the response.

---

## Finding 2 (Q-482) — a malformed id reaches Postgres on 21 route/method pairs

Of 39 pairs, **22 returned 5xx** on the malformed id. One of those (`PUT /api/nutrition/meal-types/[id]`)
also 500s on the control and is already Q-463, leaving **21 new pairs across 14 routes**:

| Route | Methods 500ing | Control answers |
|---|---|---|
| `/api/coach/apply/[id]/undo` | POST | 404 |
| `/api/friends/[id]` | DELETE | 204 |
| `/api/injuries/[id]` | PATCH, DELETE | 404 / 200 |
| `/api/nutrition/food-logs/[id]` | DELETE | 200 |
| `/api/nutrition/meal-plans/[id]` | GET, PATCH, DELETE | 404 |
| `/api/nutrition/meal-plans/[id]/review` | POST | 404 |
| `/api/nutrition/meal-plans/[id]/structure` | PATCH | 404 |
| `/api/nutrition/meal-plans/meals/[mealId]` | PATCH | 404 |
| `/api/nutrition/meal-types/[id]` | DELETE | 200 |
| `/api/nutrition/saved-meals/[id]` | DELETE | 200 |
| `/api/supplements/[id]` | PATCH, DELETE | 404 / 200 |
| `/api/supplements/[id]/log` | POST, DELETE | 404 / 200 |
| `/api/workout-review/session/[sessionId]` | POST | 400 |
| `/api/workout-sessions/[id]/{energy,recap,timing}` | GET ×3 | 404 |

**The control is what makes this a finding.** Every one of these answers a well-formed missing id
correctly — 404, or a 200/204 idempotent delete. Only the malformed id breaks them, so this is a
missing input guard, not a broken route.

**Only 2 of the 30 dynamic route files validate the id as a UUID at all.** The rest read
`const { id } = await params` and pass the string straight to the repository.

**Fix shape:** a shared guard, the same way `normalizeDateParam` exists for date params — the repo's
own precedent for exactly this class. One helper (`parseUuidParam(id)` returning 400 on failure)
applied at the top of each dynamic route, plus a Custom Rules step requiring it in any new
`app/api/**/[id]` file so the count cannot grow back. `CLAUDE.md` already argues that shape for
date params: *"new routes get the guard at creation."*

**Not a security hole.** A malformed id cannot read anyone's data — Postgres refuses the cast before
any row is touched, and every one of these routes is `auth()`-scoped. It is a correctness and
error-shape problem, and it becomes a disclosure problem only where it meets Q-483.

---

## Clean results

- **The not-found answer is right where it was fixed.** Every route in the table above returns a
  correct 404/200/204 for a valid-but-missing id — the control column is clean apart from the one
  already-filed Q-463 case.
- **Observability holds.** All of these faults reached `error_events`, tagged `[pg 22P02]` — the
  caught ones via `reportServerError`, and the bodiless 500 from `GET /api/nutrition/meal-plans/[id]`
  via `instrumentation.ts`'s `onRequestError`. Verified by querying the table after the run.

## Not verified

Local `pnpm dev`. Not on the APK, not against production. The 400s in the malformed column for
body-bearing methods are **inconclusive**, as noted above — those routes may or may not validate the
id; the probe cannot tell, because `{}` fails their body schema first. A follow-up wanting that answer
must send a schema-valid body per route.
