# 2026-08-18 — Review: what a dynamic route does with an id that is not a UUID

**Agent:** Review 📖 · **Branch:** `claude/review-dynamic-route-ids` · **Docs-only.**
**Filed:** Q-482, Q-483 · **Review:** [`docs/reviews/2026-08-18-malformed-route-ids.md`](../../reviews/2026-08-18-malformed-route-ids.md)

## The gap

Earlier sweeps probed dynamic routes with **another user's** id (protection holds) and with a
**valid-but-missing** id (Q-463). Neither covered an id that is not a UUID at all. Postgres rejects it
at cast time with `22P02`, so the question is whether the route validates first.

All 30 dynamic route files, every method, called twice — once with a well-formed-but-nonexistent UUID
as the control, once with `not-a-uuid`. 39 pairs.

## Q-483 — three routes reply with the SQL

```
GET /api/workout-sessions/not-a-uuid/recap  →  500
{"error":"[ERROR]: Error: Failed query: select \"id\", \"user_id\", \"session_id\", … "}
```

The complete `SELECT` and every column name of `workout_sessions`. The control returns
`{"error":"Not found"}` 404, so it is specific to the malformed id.

It is the route's own catch — `NextResponse.json({ error: errMsg })` where
`errMsg = errorLog(error, …)` — and `errorLog` has no environment check and no redaction, so it ships
in production as it does here. Three routes leak; a fourth carries the pattern but is guarded
upstream today.

Disclosure is to an **authenticated** user, so not an anonymous hole. Worth fixing because it
publishes table structure nothing else exposes, and `reportServerError` is already called on the line
above — redacting the response costs no diagnostics.

## Q-482 — the breadth

22 of 39 pairs returned 5xx; one is already Q-463, leaving **21 new pairs across 14 routes**. Only
**2 of the 30** dynamic route files validate the id as a UUID at all; the rest read
`const { id } = await params` and hand the string to the repository.

The control is what makes it a finding: every one of those routes answers a well-formed missing id
correctly. Only the malformed id breaks them.

**Not a security hole** — Postgres refuses the cast before any row is touched and every route is
`auth()`-scoped. It becomes a disclosure problem only where it meets Q-483, which is why that is
queued above it.

## Reading the evidence

A **500 is conclusive** — the request reached the database. A **400 is not**: the probe sent `{}`, so
a body-bearing method may have failed its body schema before the id was used. Routes absent from the
table are verified-correct only if they are GET or DELETE. That caveat is in both entries, because
without it the table reads as an all-clear for everything it omits.

## Clean

The not-found answer is right everywhere it was fixed — the control column is clean apart from the
one already-filed Q-463 case. And observability holds: every fault reached `error_events` tagged
`[pg 22P02]`, via `reportServerError` or `onRequestError`, verified by querying the table.

## Not verified

Local `pnpm dev`. Not on the APK, not against production.
