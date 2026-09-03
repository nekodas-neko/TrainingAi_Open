# Ownership rule (a) holds everywhere; the id guard that protects it was only ever pointed at path params

**Date:** 2026-09-03 · **Agent:** Review 📖 (sweep 43) · **Pillars:** `[workouts]` `[platform]`
**Lens:** **write-path ownership rule (a)** — *"after a user-scoped UPDATE whose row id came from the
client, check the affected-row count before any dependent child write"* — the last of `CLAUDE.md`'s
three ownership rules with no evidence behind it. Rule (b) came back clean in sweep 40; rule (c)
produced RV-32.

**Rule (a) is clean, and now has evidence.** Every delete-and-reinsert-by-parent-id site in the data
layer is guarded, both incidents the rule was written from are verified fixed end to end, and no
forged id changed or destroyed a row.

The sweep found its defect one layer out: the guard that keeps a malformed id away from these
functions is applied to **27 of 27 dynamic `[id]` routes and 0 routes that take the id in a request
body**, and two of those body routes answer `500`.

---

## 1. Method, and what it does not establish

The app was run. Two real signed-in accounts against the local seeded Postgres — **A** = the seeded
`test@local.dev`, **B** = the harness's `zero@local.dev` — every probe a live HTTP request with a real
session cookie, and **every outcome confirmed by reading the row back out of Postgres** rather than
from the response body.

What this does not establish:

- **It is the web build**, and it is the local seeded database, not production.
- **`workout_log` and `activity_logs` are the only outbox domains.** An earlier draft of §4 claimed
  the 5xx-retry consequence for these two routes; program and style saves are not pushed through the
  outbox, so that claim was **removed rather than softened**. The asymmetry itself is real
  (`sync-engine.ts:868`), it just does not reach here.
- **Two of eight candidate routes are still unverified** — see §4's table. They are recorded as
  unverified, not as clean.

---

## 2. Rule (a): the inventory, and why every site holds

Every `.delete()` in `lib/data/postgres/` whose `WHERE` carries no `userId` term — the shape the rule
is about — is **21 statements across 12 functions**. Each was traced to its guard:

| Function | Client-supplied id | Guard |
|---|---|---|
| `saveProgressionStyle` | style id | row-count on the UPDATE, `if (updated.length === 0) throw NotFoundError` |
| `writeSavedMeal` | meal id | `setWhere: eq(userId)` on the upsert + `if (!meal) throw NotFoundError` |
| `saveProgram` | program id | row-count, `if (!r) throw NotFoundError` (Q-129) |
| `replaceVolumeTargets` | program id | pre-check SELECT inside the transaction (Q-174, comment cites this rule) |
| `replaceMealPlanStructure` | plan id | `ownedPlan()` pre-check |
| `updatePhaseSet` / `deletePhaseSet` | phase-set id | user-scoped SELECT, `throw NotFoundError` |
| `removeSessionExercise` | session-exercise id | three-table join to `programs.user_id` |
| `upsertBloodPanel` | panel id | derived from a user-scoped SELECT; UPDATE also user-scoped |
| `upsertDexaScan` | — | conflict target is `[userId, scannedOn]`; the id is never client-supplied |

Nothing outside `lib/data/postgres/` has the shape at all: `packages/shared/src/`, `lib/local-store/`
and `app/api/` contain no delete-and-reinsert-by-parent-id.

**Two guard styles are in use** — a row-count check on the UPDATE, and a pre-check SELECT. The rule
names the first; the second is equivalent where it runs inside the same transaction as the delete
(`replaceVolumeTargets`, `saveProgram`). Three sites run the pre-check *outside* the transaction
(`replaceMealPlanStructure`, `updatePhaseSet`, `deletePhaseSet`). That is a theoretical
time-of-check/time-of-use window and **is not filed**: closing it needs a row to change owners
between the two statements, and nothing in this app transfers ownership of anything.

## 3. Both incidents the rule was written from, verified fixed

`CLAUDE.md` names `saveProgressionStyle` and `updateSavedMeal` as the class. Both were driven as B
against A's real rows, with the child rows counted before and after:

| Probe | Response | A's data after |
|---|---|---|
| B → `POST /api/progression-styles` with A's style id | **404** `{"error":"Progression style not found"}` | name `Testing` unchanged, **3 of 3 `style_sets` survive** |
| B → `PUT /api/nutrition/saved-meals/<A's meal>` | **404** `{"error":"Saved meal not found"}` | name `A meal`, owner still A, **1 of 1 `saved_meal_items` survives** |
| B → `POST /api/workout-templates` with A's program id | **404** `{"error":"Program not found"}` | `Push Pull Legs`, 3 sessions, **9 session_exercises** |
| B → `PUT /api/phase-sets/<A's>` | **404** `{"error":"Phase set not found"}` | `S+H Progression`, **6 program_phases** |
| B → `DELETE /api/phase-sets/<A's>` | **404** | still present |

The first row is the Q-174 incident itself — the wipe the rule exists to prevent — reproduced and
refused, with the child rows counted rather than assumed.

**One near-miss in the method, worth more than the result.** The saved-meal probe first appeared to
show a hijack: B's `PUT` returned `200` with a full meal body. It had not. A's `POST` had failed
`400` moments earlier (a shell bug — `psql -tAc "… returning id"` prints the command tag as well as
the id, so the JSON carried a two-line `foodItemId`), so the row did not exist and B's upsert
**created it as B's own**, which is correct. The tell was `userId` in the response body being B's.
A conclusion drawn one step earlier would have been a fabricated cross-user finding.

## 4. RV-40 — the malformed-id guard was only ever pointed at path params

`invalidUuidResponse` (`lib/api/route-errors.ts:83`) exists because Q-482 measured **21 route/method
pairs answering 5xx** on `not-a-uuid`. Its own doc comment calls it *"the guard every dynamic `[id]`
route runs before its id reaches the repository"* — and that is exactly the population it got:

> **27 route files use it. 27 of 27 are dynamic `[id]` routes. Zero take the id from a body.**

An id in a request body is the same hazard and was never in the sweep's population. **13 route files
take an id-shaped field from the body without the guard**; eight of those have no `z.string().uuid()`
either. All eight were probed live:

| Route | Malformed body id | Verdict |
|---|---|---|
| `POST /api/progression-styles` | **500, `Content-Length: 0`** | **broken** |
| `POST /api/workout-templates` | **500** `{"error":"Save failed"}` | **broken** |
| `POST /api/phase-sets/clone` | 404 JSON | clean |
| `POST /api/workout-sessions/rpe` | 400 JSON | clean |
| `POST /api/confirm-early-deload` | 403 JSON | clean |
| `GET /api/coach/options` | 400 JSON | clean |
| `POST /api/complete-workout` | — | **unverified** — the probe was rejected on other fields first |
| `POST /api/log-exercise` | — | **unverified** — same |

**Three sibling routes answer the identical client mistake with `400 {"error":"Invalid id"}`.** Same
session, same class of malformed input, different answers.

### Why the empty body is the worse half

`POST /api/progression-styles` returns **zero bytes and no `Content-Type`** at 500. A client calling
`res.json()` on that gets a parse exception on top of the real fault — which is verbatim the
rationale RV-33 was filed under, on **one of the two routes RV-33 fixed**. RV-33 wrapped the
*ownership refusal* path in `withRouteErrors`; the malformed-id path throws from the driver before
reaching it, so the fix and the gap coexist in one file.

### The third consequence, measured rather than argued

Both routes write a row to `error_events` for what is a client input error, and the stored message
carries the raw SQL:

```
POST /api/progression-styles | server | [pg 22P02] Failed query: update "progression_styles"
  set "name" = $1, "updated_at" = $2 where ("progression_styles"."id" = $3
  and "progression_styles"."user_id" = $4) returning "id"
```

Five probe requests produced five rows. This is the Q-483 class one step removed — the SQL is not
returned to the caller, it is *stored* in the fault channel `CLAUDE.md` tells every session to read
first. Anyone sending a bad id fills it with noise that is not a fault.

## 5. Filed

| ID | Pillar | What |
|---|---|---|
| **RV-40** | `[workouts]` `[platform]` | Two routes 500 on a malformed body id — one with a zero-byte body — because `invalidUuidResponse` was only applied to `[id]` path routes. Both also write an `error_events` row containing the raw SQL |

One entry, not two: it is one pattern across two files with one fix and one verification pass, which
`docs/agents/README.md` §3 says is already a batch and must not be split.

**Rule (a) is not filed.** It is clean, and §2–§3 are the evidence it previously lacked.

## 6. Method notes

- **`psql -tAc "… RETURNING id"` prints the command tag too.** A `$(…)` capture of it is two lines,
  and the malformed JSON that follows returns a `400` that reads exactly like a validation finding.
  Pipe through `head -1 | tr -d '[:space:]'`.
- **Read `userId` out of the response body before calling anything a cross-user hijack.** An upsert
  against an id that does not exist *creates* the row as the caller's, which is correct and looks
  identical to a takeover from the outside.
- **A 4xx is not evidence the guard fired.** Six of the eight probes in §4 first returned a 400 for a
  *different* missing field, which would have read as "clean" from the status alone. Only the two
  that reached the id prove anything, and the four re-probed with corrected bodies had to be
  corrected before they counted.
- **`error_events` on the local dev database answers "what did that request cost".** One query after
  a probe run shows whether a refused request is being recorded as a fault, which is not visible from
  the response at all.
