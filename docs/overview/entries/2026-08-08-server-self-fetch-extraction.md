# 2026-08-08 — The server stopped making HTTP calls to itself

**Domain:** platform / workouts — v1.270.4, JS-only (no APK rebuild)

## The gap

Q-122, from the 2026-08-07 full-app review (§3.5). Three places where a route did `fetch()` against
`req.nextUrl.origin`, forwarding the caller's cookie, to reach work this same process could do
directly:

- `complete-workout/route.ts:39` → `POST /api/oura/hr-sync`
- `workout-data/route.ts:503,527` → `POST /api/ai-periodization/session/[id]/prescribe`

Not theoretical: `/api/complete-workout#hr-sync` logged a bare `"fetch failed"` **9 times, 5 of
them in the 8 days before the review**, most recently 2026-08-06 22:11. When the loopback fails
that workout's Oura HR sync is silently skipped — recoverable (the admin backfill is
coverage-aware) but invisible, and the recap shows no HR breakdown until someone runs it. Each
round trip also burns a second request worker and a second pool connection, which compounds
Q-107's connection pressure.

## The fix

**New shared module `lib/workout/post-completion-hr.ts`** — `syncAndAttributeSessionHr(userId,
workoutSessionId, tz?)`: load the session, pull its Oura HR window, then attribute the readings to
the workout and its sets. Three callers now share it: `POST /api/complete-workout`, `POST
/api/oura/hr-sync` (now a thin HTTP wrapper over the same function, still needed —
`health-content.tsx:617` calls it from the client), and, next PR, the outbox's `complete_workout`
branch (Q-123a).

**Prescribe** — the two `fetch`es become `regeneratePrescriptionInBackground(...)`, a local helper
that calls `generatePrescriptionForSession` directly. The route it replaced is itself a thin
wrapper over that function, so the work is identical. The helper **re-applies the same
`prescribe:<userId>` rate-limit budget (20/hr)** the route enforced, because bypassing the HTTP hop
would otherwise also bypass the limit that keeps an unattended poll loop from minting unlimited
Gemini calls.

## One behaviour change, deliberate

The completion route used to fire hr-sync and the attribution pass **in parallel**, so attribution
almost always ran against the pre-sync rows. They are now sequential — sync, then attribute — which
is what the attribution pass wanted in the first place. It remains best-effort: an Oura ring drains
its buffer minutes-to-hours later, so this pass often still has nothing to attribute, and the
coverage-aware backfills stay the safety net.

The error tag also changed from `#hr-sync`/`#hr-stats` to a single `#hr-pipeline`. Deliberate: the
9 historical `#hr-sync` rows in `error_events` mean "the loopback fetch failed", a failure mode that
no longer exists, so a new tag keeps that history readable instead of blurring old and new.

## Verification

`tsc --noEmit` clean · `eslint` on all touched files matches the pre-existing baseline (the
`'result' is assigned but never used` warning in `complete-workout/route.ts` is on `main` too —
confirmed against a stashed tree) · `scripts/check-push-mutations.js` OK ·
`scripts/check-doc-links.js` OK · full suite 404 files / 3218 tests, one failure
(`scale-ble-multi-reading.test.ts`) that **also fails on a stashed clean tree** — it needs a second
user row the local seed does not have. Local-seed artifact, pre-existing, unrelated.

**Live-verified against `pnpm dev`:**
1. `POST /api/complete-workout` on a real seeded session → `200`, session marked complete, and
   **no inbound `POST /api/oura/hr-sync` in the dev server's request log** (the loopback would have
   appeared there as its own request). No `error_events` row.
2. `GET /api/workout-data?session=<id>` with the program flipped to `ai_dynamic` and
   `prescription_status = 'consumed'` (so `aiPrescriptionPending` is true): the route returned
   `200` immediately, **no inbound `POST /api/ai-periodization/.../prescribe`** appeared in the
   log, and 20 seconds later the DB row carried a freshly generated prescription
   (`prescription_generated_at = 03:12:47`, real Gemini reasoning text, status flipped back to
   `pending`). The in-band call did the whole job the loopback used to.

Local seed restored afterwards: `phase_mode = 'manual'`, periodization rows and the test workout
session deleted.

One new unit test asserts the completion route makes no `/api/oura/hr-sync` request; the existing
fire-and-forget test was updated for the new error tag.

**Not exercised:** the outbox's `complete_workout` branch still self-fetches — that is Q-123(a),
next PR, and it now has a shared function to call. No on-device verification — server-only, no
native, safe-area or gesture surface touched.
