# Review sweep 43 — ownership rule (a) audited, and the id guard that was only pointed at path params

**Date:** 2026-09-03 · **Agent:** 📖 Review · **Branch:** `claude/review-agent-sweep-43` · Docs only.

The last of `CLAUDE.md`'s three write-path ownership rules with no evidence behind it: **rule (a)** —
*"after a user-scoped UPDATE whose row id came from the client, check the affected-row count before
any dependent child write"*. Rule (b) came back clean in sweep 40; rule (c) produced RV-32.

**Rule (a) is clean, and now has the evidence it lacked.** All 21 unscoped child deletes across 12
functions in `lib/data/postgres/` are guarded, and nothing outside that directory has the shape at
all. Both incidents the rule was written from were driven end to end as a second account against the
first's real rows, with the child rows counted before and after:

| Probe | Response | A's data after |
|---|---|---|
| B → `POST /api/progression-styles` with A's style id | 404 JSON | name unchanged, **3 of 3 `style_sets` survive** |
| B → `PUT /api/nutrition/saved-meals/<A's>` | 404 JSON | owner still A, **1 of 1 item survives** |
| B → `POST /api/workout-templates` with A's program id | 404 JSON | 3 sessions, **9 session_exercises** |
| B → `PUT` / `DELETE /api/phase-sets/<A's>` | 404 JSON | **6 program_phases**, still present |

The first row is the Q-174 wipe the rule exists to prevent, reproduced and refused.

**The one finding is a layer out. RV-40.** `invalidUuidResponse` exists because Q-482 measured 21
route/method pairs answering 5xx on `not-a-uuid`. Its own comment calls it *"the guard every dynamic
`[id]` route runs"*, and that is the population it got: **27 route files use it, 27 of 27 are dynamic
`[id]` routes, zero take the id from a body.** An id in a request body is the same hazard and was
never swept.

Thirteen route files take a body id without the guard; the eight with no `z.string().uuid()` either
were all probed. `POST /api/progression-styles` answers **500 with `Content-Length: 0`** — on the very
route RV-33 fixed, because RV-33 wrapped the *ownership refusal* and the malformed-id path throws from
the driver before reaching it. `POST /api/workout-templates` answers `500 {"error":"Save failed"}`.
Four are clean, two remain **unverified**. Three sibling routes answer the identical mistake with
`400 {"error":"Invalid id"}`.

Both also write an `error_events` row carrying the raw SQL — `update "progression_styles" set "name"
= $1 …` — for what is a client input error. Five probe requests, five rows, in the fault channel every
session is told to read first.

**Two things this sweep got wrong first and corrected.** The saved-meal probe appeared to show a
cross-user hijack; it was a shell bug (`psql -tAc "… RETURNING id"` prints the command tag too), so
A's create had failed and B's upsert correctly created the row as B's own — the tell was `userId` in
the response body. And an earlier draft claimed the offline-outbox retry consequence for these two
routes; `workout_log` and `activity_logs` are the only outbox domains, so it was removed rather than
softened.

**Not exercised:** the device, and production — this is the web build against the local seeded
database. The two unverified routes are recorded as unverified, not clean.

Write-up:
[`docs/reviews/2026-09-03-ownership-rule-a-and-body-supplied-ids.md`](../../reviews/2026-09-03-ownership-rule-a-and-body-supplied-ids.md).
