# Review — 2026-08-18 · nutrition, cardio and activity writes, and the not-found status across the whole write surface

_Section sweep continuing from the workout write-path review. Two halves: the **nutrition / cardio /
activity** mutations probed cross-user the same way workouts were, and then — because the workout
sweep's Q-462 looked like it might not be a one-off — **every dynamic write route in the app**
measured uniformly against a nonexistent id._

_Findings: **Q-463**. Two areas came back **clean**, one of them a pattern I expected to file and did
not._

## Method, and what it does not establish

**Half 1 — cross-user, nutrition/cardio/activity.** Rows were created as user A through the real
routes (a supplement, a food item, a food log, a meal type, a water log, an activity log), then user B
called every mutation against A's row ids, then A's rows were re-read from Postgres. **A control ran
for every probe** — the same call by A on A's own row — because a 4xx or 5xx proves nothing about
protection if the payload was simply wrong. That control mattered: four probes returned bodiless
500s that looked like faults, and the controls returning 200 are what established they were genuine
ownership rejections rather than my bad requests.

**Half 2 — the not-found status, everywhere.** Every `app/api` route with a dynamic segment and a
write method (`POST`/`PATCH`/`PUT`/`DELETE`) was called **as an authenticated user with a fabricated
UUID** — `00000000-0000-4000-8000-0000000fffff`. That isolates one question across the whole surface:
what does this app do when the row you named does not exist? The correct answer is the same
everywhere. **33 endpoints** answered.

**What this does not establish.** The **web** build — no device path, no native SQLite, no safe-area
or WebView claim. A fresh correct local seed, so nothing about prod drift. The 12 endpoints that
returned `400` did so because my empty `{}` body failed validation *before* the id was ever looked up;
**those are not evidence either way** and are excluded from the finding rather than counted as
correct. Half 1 covered the nutrition/cardio/activity mutations reachable with the rows I could
create — the meal-plan generation routes, the running-plan writes and the scan/barcode path were not
exercised.

---

## Q-463 — "the row you named does not exist" is answered five different ways, and five routes answer it with a 500

**Severity: medium.** `[platform][nutrition][workouts][devices]`

Of 33 dynamic write endpoints probed with a nonexistent id:

| Answer | Count | Verdict |
|---|---|---|
| `404` with a JSON error | 8 | **correct** |
| `200`/`204` on a `DELETE` | 7 | **defensible** — see Clean, below |
| `400` from body validation before the id lookup | 12 | not evidence; excluded |
| `403` (admin gate fires first) | 1 | correct |
| **`500`** | **5** | **the finding** |

The five:

```
PATCH  /api/injuries/[id]                 500   (empty body)
PUT    /api/nutrition/meal-types/[id]     500   (empty body)
PATCH  /api/supplements/[id]              500   (empty body)
POST   /api/supplements/[id]/log          500   (empty body)
DELETE /api/phase-sets/[id]               500   {"error":"Phase set not found"}
```

`POST /api/log-exercise` is a sixth, already filed as **Q-462** — this entry is what shows that one
was not an isolated case.

**The cause is one shape repeated.** Repository methods throw a bare `Error('… not found')` — 16 such
throws across `lib/data/postgres/` and `packages/shared/src` — and the routes above have nothing that
maps them to a status, so Next's default handler turns them into a 500. Confirmed from the dev log
during the cross-user probe: `Error: Supplement not found`, `Error: Food log not found`,
`Error: Meal type not found`, each with a full stack trace.

**One resource answers two ways on two verbs.** `PUT /api/phase-sets/[id]` returns
`400 {"error":"Phase set not found"}` and `DELETE /api/phase-sets/[id]` returns
`500 {"error":"Phase set not found"}` — same resource, same condition, same message, two different
wrong statuses. Neither is 404.

**Why it is worth fixing rather than filing as cosmetic.** Three consequences, all of them things
this repo has already written rules about:

1. **The sync client retries what can never succeed.** `CLAUDE.md`'s outbox rule is explicit — *"A
   4xx/validation failure is a poison pill: quarantine it, don't retry forever. 5xx/429 = back off and
   retry."* A permanent "this row is not yours / does not exist" reported as 5xx is classified as
   transient by that rule.
2. **Four of the five return an empty body**, so a client doing `res.json()` on the failure throws a
   parse exception on top of the original error, and whatever error state it meant to show never
   renders.
3. **It pollutes the one fault signal nobody watches.** `error_events` is, per `CLAUDE.md`, *"the only
   view of faults that never reach a human"*, it prunes at 30 days, and reading it is part of the
   session-start ritual. Every correctly-refused request writing a stack trace into it makes that
   table worse at its job.

**Fix shape:** a typed error in the repository layer (`NotFoundError` / `NotOwnedError`) and one
shared mapper at the route boundary, rather than 16 call sites each remembering. `/api/nutrition/
meal-plans/*` is the in-repo reference — **all five** of its write endpoints return a clean
`404 {"error":"Not found"}`. **Lane A** (repository + `app/api`).

---

## Clean — two results, one of which I expected to file

**1. Cross-user write protection holds across nutrition, cardio and activity too.** Nine mutations
called by user B against user A's real rows, with A's rows re-read from Postgres afterwards:

| Call (B → A's row) | Result | A's data |
|---|---|---|
| `PATCH`/`DELETE /api/supplements/[id]` | 500 / 200 | **`Creatine`, unchanged** |
| `POST /api/supplements/[id]/log` | 500 | no log written |
| `PATCH`/`DELETE /api/nutrition/food-logs/[id]` | 500 / 200 | **qty still `1.5`** |
| `PUT`/`DELETE /api/nutrition/meal-types/[id]` | 500 / 200 | **still `Breakfast`** |
| `PATCH /api/activity-logs/[id]/metrics` | **404** | distance unchanged |
| `DELETE /api/activity-logs` | 200 | **row still alive** |

Nothing crossed accounts, on any of them. Combined with the workout sweep, **every workout,
nutrition, cardio and activity mutation reachable in this harness has now been probed cross-user and
none of them leaked or destroyed another user's row.** The 500s and 200s above are Q-463 and the
DELETE semantics below; neither is a protection failure.

**2. `DELETE` returning `200`/`204` for a row that does not exist is defensible, and I am not filing
it.** Seven routes do it — `injuries`, `food-logs`, `meal-types`, `saved-meals`, `supplements/[id]`,
`supplements/[id]/log`, `friends` (204), plus `activity-logs`. It looks like the same
"success for a write that changed nothing" shape as Q-460, and it is not: `DELETE` is idempotent by
HTTP convention, the desired end state (row absent) genuinely holds, and the client's outbox is
correct to treat the mutation as done. **Q-460 is different because the desired end state was
`session_rpe = 7` and it did not hold.** Recorded so a later sweep does not file the benign half of
the pattern.

**3. The nutrition screen renders and reads correctly.** Driven live: the day's totals
(`760 kcal · P 26 · C 120 · F 14`), the water figure reflecting the `0.5 L` written through the API
minutes earlier, meal-type sections and per-meal macros — **zero uncaught page errors, zero console
errors, zero failing `/api/` responses**. The meal-type emoji (🍳 🍎 🥗 🍪) are user-configurable
content with their own `emoji` column, which `CLAUDE.md` explicitly exempts from the
Lucide-icons rule — checked rather than assumed.

## Section coverage after this sweep

The half-2 probe was deliberately app-wide, so it covers every pillar's dynamic write routes at once.
Combined with the preceding sweeps, the **write surface** is now swept for: `workouts`, `nutrition`,
`cardio`, `activity`, `body` (scale-ble), `devices` (scale-ble/phase-sets), `platform`, `app-shell`
(friends/coach), plus `readiness`/`sleep`/`heart-rate` to the extent they expose dynamic write routes
— which, notably, **they barely do**: those three pillars are read-and-derive, and their writes arrive
through ingest and sync rather than through `[id]` routes. That is why the remaining sweep for them
has to be a different lens, and it is recorded as next in the baton.
