## 2026-07-23 — Fix: activity_logs push validation failure (null vs undefined, v1.208.5)

**Branch:** `claude/oura-ondevice-hybrid-phase-2-f4ahnd`. Separate bug from the Oura sync investigation
(#761/#769/#779/#780) — surfaced only once that fix landed and Sync started actually running to completion,
exposing pre-existing failed outbox items: **"2 changes failed to sync — Activity — 2026-07-23 — Invalid
activity_logs payload (5 attempts)."**

### Root cause
Both activity-logging UI components build the `queueMutation` payload by reusing the exact same object
literal they just used for the local SQLite write (`upsertActivityLog`), where optional fields are correctly
`T | null` (real SQLite NULLs). But the server's push validation (`ActivityLogBody`,
`lib/validation/activity-log.ts`) declares those same fields `.optional()` — `T | undefined`, not `T | null`.
Zod's `.optional()` **rejects an explicit `null`** outright, and `safeParse` fails the *whole* payload on any
one bad field — exactly the class CLAUDE.md already documents ("this broke every food save in v1.42.4").

- `components/guided-walk/walk-summary.tsx` — a guided walk has no GPS/step tracking, so **every** optional
  field (`distanceKm`, `steps`, `notes`, `routePolyline`, `splits`, `bestEfforts`, `paceSeries`,
  `avgPaceSecPerKm`, `elevationGainM`, `elevationLossM`) is hardcoded to `null` on every save →
  **100% failure rate**, matching "5 attempts" (the outbox's dead-letter threshold) exhausting immediately.
- `components/activity/done-activity-screen.tsx` — identical `?? null` pattern, just triggers less often
  (fails only when a GPS-derived field happens to be missing).

### The fix
New shared helper `omitNullFields()` in `lib/local-store/sync-helpers.ts` (the existing pure-helpers file
for the sync engine) — strips null-valued keys from an object so they're **omitted** (undefined) rather than
sent as `null`, matching this file's own established convention (`buildWorkoutLogPayload`'s
`...(x != null ? {...} : {})` spreads). Wrapped the `payload` object at both `queueMutation` call sites —
**not** the local `upsertActivityLog` calls, which correctly want real nulls for SQLite.

### Verification (sandbox)
- New tests import the **actual production `ActivityLogBody` Zod schema** and prove: (1) the exact
  guided-walk-shaped payload (all-null optionals) fails validation before the fix and passes after; (2) a
  mixed real-value/null payload also passes after, with real values (`distanceKm: 5.2`) surviving intact;
  (3) `omitNullFields` only drops `null`, preserving `undefined`/`0`/`''`/`false`. 18/18 `sync-helpers` tests
  green; full `lib/local-store` suite green (55 tests).
- `tsc`: only the 2 pre-existing `onnxruntime-web` errors. Changed-file eslint clean.
- Confirmed no other production `queueMutation({ domain: 'activity_logs', ... })` call site exists (only a
  test fixture) — both real sites are fixed.
- **Existing failed outbox items on the owner's device are NOT auto-repaired by this deploy** — they were
  queued with the bad (null-laden) payload baked in *before* this fix shipped. `retryFailedMutation`
  (`sqlite-backend.ts:1979`) only resets the stored row's `status`/`attempts` and resends the **same stored
  payload bytes** — it does not rebuild the payload from the current `activity_logs` row, so tapping **Retry**
  on those two specific items will fail again with the identical error even after this fix deploys.
  **Discard is the correct action for the two already-stuck items** — `deleteMutations` only removes the
  outbox row (CLAUDE.md's stable-mutation-id rule); it does not touch `activity_logs`, so the logged walks
  stay in local history. Any **new** guided-walk/activity save after this deploy queues via the fixed code
  path and syncs normally.

### User-visible → bumped
`package.json` 1.208.4 → **1.208.5** (patch, bug fix) + `lib/changelog.ts` entry.
