# API & security quick wins — webhook oracle, ingest validation, unguarded AI, rate limits

> Source: post-update review 2026-07-04 (AI/security pass). Small, independent
> hardening fixes — no schema change. Anchors verified against `main`; **re-grep
> before editing**. Ships as **one PR** (patch, merge-gate-exempt). Note: the review
> confirmed the CLAUDE.md "five routes bare-parse LLM output" claim is **stale** —
> all structured routes use `generateObject` now; no fix needed there (the CLAUDE.md
> wording update is in this batch's docs entry).

## Task 1 — Oura webhook: verify signature before the DB lookup

**Root cause:** `app/api/oura/webhook/route.ts:50-62` looks up
`getUserIdByOuraUserId(body.user_id)` from the **unverified** body before HMAC
verification. Unknown user → 200, known user + bad signature → 403. An
unauthenticated caller can enumerate which Oura user_ids are connected to the app by
observing 200 vs 403. (Signature verification itself is properly fail-closed —
missing header/key → 403.)
**Fix:** move `verifyOuraWebhookSignature` **before** any DB lookup keyed on the
payload. Reject on bad/missing signature identically regardless of whether the user
exists. Also add a payload size cap on `req.text()` (reject oversized bodies) —
currently unbounded.

**Verify:** a request with a bad signature returns 403 whether or not `user_id` maps
to a real user (no 200/403 divergence pre-verification); an oversized body is
rejected.

## Task 2 — Health Connect ingest: validate input with a Zod schema

**Root cause:** `app/api/health-connect/ingest/route.ts:36-70` has no schema; numeric
fields (`weightKg`, `steps`, …) pass to `upsertBodyMetrics` with zero type/range
validation — a string `"75kg"` or a `1e308` number goes to the driver and surfaces as
a generic 500 (or a coerced garbage row). (The shared-secret comparison is
constant-time and fail-closed — good; keep it.)
**Fix:** add a Zod schema (numeric fields coerced + range-bounded, unknown keys
stripped) parsed with `.safeParse`; reject with a 400 on failure. Follow the
Zod null-vs-optional rule — fields the client may omit are `.optional()` (not
`.nullable()` unless the client actually sends `null`).

**Verify:** a malformed ingest payload returns 400, not 500; a valid one still
upserts.

## Task 3 — Wrap the two unguarded `generateText` routes

**Root cause:** `ai/health-insight/route.ts:106-109` and
`weekly-digest/route.ts:148-152` call `generateText` with no try-catch → a Gemini
failure/timeout escapes as an unhandled route error (framework 500), not the rule's
JSON error. Contrast `prescribe/route.ts:216-231` which catches and returns
`{error}` 502.
**Fix:** wrap both in try-catch returning a JSON error response, matching the
`generateObject` routes. Also give `oura/webhook/route.ts:135`'s
`syncHrForSession(...).catch(() => {})` a log line (it currently swallows silently).

**Verify:** force a model error locally (bad key / throw in a stub) → the route
returns a JSON error, not an HTML 500.

## Task 4 — Rate limits + JSON-parse guards on the two unprotected write routes

- `app/api/day-checkin/route.ts` — POST has no `rateLimit()` (sibling
  `app/api/mood/route.ts` has one); and `Body.safeParse(await req.json())` at `:30`
  has no `.catch()`, so malformed JSON throws a 500 before `safeParse` (the RPE route
  does it right: `req.json().catch(() => null)` at `workout-sessions/rpe/route.ts:10`).
- `app/api/workout-sessions/rpe/route.ts` — no `rateLimit()` (siblings log-exercise /
  complete-workout have one).

**Fix:** add the standard `rateLimit()` (match the sibling's config) to both; wrap
`day-checkin`'s `req.json()` in `.catch(() => null)` → 400.

**Verify:** each route rejects over-limit requests with 429 and malformed JSON with
400.

## Task 5 — `user_stats.total_volume_kg` drift on edit (flag / optional fix)

**Root cause (pre-existing, PLAUSIBLE-MED):** `user_stats.total_volume_kg`/
`total_sets` (migration 073) have a replay guard but **no reconcile-on-read**, and the
`workout-entry` PATCH edit path changes `exercise_logs.volume` without adjusting the
counter — it drifts on every edited set. The stored-counter rule mandates
derive-on-read or a reconcile-on-read self-heal.
**Fix (if in scope):** either adjust `user_stats` in the edit PATCH (delta the
counter by the volume change, scoped to user), or add a `reconcileUserStats`
self-heal on read (the `reconcileSessionsInPhase` pattern). If it's too much for this
quick-wins PR, leave it as a flagged follow-up in `planned_upgrades.md` rather than
half-doing it.

**Verify:** edit a logged set's weight/reps → the profile total volume reflects the
change (or self-heals on next read).

## Wrap-up

- `pnpm tsc --noEmit && pnpm lint && pnpm test`; add route-level tests for the
  webhook verify-before-lookup ordering and the ingest schema rejection if the
  existing route-test pattern supports it.
- `pnpm dev` curl checks per task (bad signature, malformed ingest, over-limit
  day-checkin/rpe, forced model error).
- **Not exercisable in sandbox:** a real Oura webhook signature, a real Health
  Connect payload, live Gemini failures — declare; the logic is verifiable by curl
  against the local DB.
- Patch bump + changelog; merge-gate-exempt. Remove this backlog entry in the same
  PR.
