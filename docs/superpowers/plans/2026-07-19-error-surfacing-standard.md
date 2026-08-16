# Feature: the app's error-surfacing standard (K batch — silent failures become specific states)

**Source:** deep review `docs/reviews/2026-07-18-deep-app-review.md` §K (K1–K9; K4 verified
REAL/high — mechanism worse than reported; K2/K3 verified medium; §K Design notes hold the full
inventory + standard). Branch: `feat/error-surfacing-standard`.

## The standard (from §K design notes — adopt verbatim, then apply)

- **Toast** only for user-initiated writes that failed *and* have no outbox fallback.
- **Inline stale/error state** (small cause + retry) for self-fetching cards — failure renders as
  a state, never as absence; offline renders as *stale-data* (offline is NOT an error).
- **Notify** (local notification / banner) only for: dead-lettered outbox mutations at quarantine
  time, and a dead local store (writes at risk).
- **Telemetry**: every server 500 on a side-effect route and every rollup/sync-engine failure
  writes an `error_events` row.

## Tasks (severity order)

1. **K4 (high):** dead local store surfacing — native init failure currently yields a *non-null*
   store whose `runSQL` silently no-ops: food/body-metric writes are lost **even online, with
   success toasts** (workout logs survive via direct POST). Detect the dead-store condition at
   init, set a global flag: banner on write-capable screens + `error_events` row + route writes to
   the direct-POST fallback while dead. (The data-loss core is R3 plan Task 4.2
   `2026-07-09-r3-offline-first-integrity.md:414-436`, still pending — this task is the surfacing
   half and the fallback rerouting; implement together if R3 4.2 is taken now.)
2. **K3 (medium):** dead-letter quarantine (`lib/sqlite/sqlite-backend.ts:1630-1646`) fires a
   one-time toast + badge on the More tab at quarantine time (surface exists only as a
   mount-refresh card today: `sync-health-card.tsx:37`).
3. **K2 (medium):** give `cachedFetch` a failure channel (onError callback or rejected promise
   variant) and use it on the workout screen (its error toast at `workout-screen.tsx:366-368` is
   dead code today) + the K9 card list.
4. **K5 (medium):** strap HR flush splices its buffer before POST — re-buffer on failure with a
   size cap so a failed flush doesn't permanently lose the samples.
5. **K1 (medium):** `app/workout/error.tsx` reports to telemetry like its siblings.
6. **K8 (medium):** extend `reportServerError` to the heavy side-effect routes (complete-workout
   first; currently 3 of 176 routes).
7. **K7 (medium):** pull-to-sync reports push/pull failure state instead of always succeeding.
8. **K9 (medium):** sweep the health/home self-fetching cards to the inline-error standard
   (worst-first list in §K design notes).
9. **K6** is implemented in P4 task 3 (rollup failure telemetry) — do not duplicate.

## Verification

Dev-server: simulate 500s/rate-limits per surface and screenshot the states; unit tests for the
cachedFetch failure channel and dead-store detection; `pnpm test` green. Device gates: dead-store
banner and quarantine toast are APK surfaces — Known-Issues rows if no device in-session.
