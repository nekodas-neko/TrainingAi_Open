# Batch N — Platform & Ops

**Branch:** `feat/platform-ops` · **Three chunks, one PR each** (chunk = a coherent, independently-shippable slice; implement in order). From the 2026-07-03 backlog review: the app has strong in-app integrity but near-zero operational safety net — prod errors are invisible, there is no export/backup/recovery story, and the most incident-prone code path has no tests.

**Migration claim: 109** (`109_error_events.sql`, chunk 2). 107 = Batch I supersets, 108 = time-model plan, 110 = Batch O measurements. Verify against the directory AND open plans before applying (CLAUDE.md rule).

Key current-state facts (verified 2026-07-03):
- `lib/error-handler.ts` (`AppError`/`handleApiError`) is dead code — zero importers; `lib/logger.ts` has 4 importers; no global client error listener; the only error boundary is `app/workout/error.tsx`.
- `lib/push.ts` `sendPushToUser` has **zero callers**; client subscribe plumbing works (Profile toggle → `subscribeToPush()`); the 410-cleanup loop only deletes the **first** expired subscription per send cycle.
- No `/api/version`, no `App.getInfo()` usage; client version comes from `CHANGELOG[0].version` only.
- No streaming/NDJSON route exists; `getSyncDelta` is the closest "everything" aggregate.
- `oura_heartrate` written only via `repo.upsertOuraHeartrate` (`lib/oura/hr-sync.ts:24`); the throttled opportunistic-prune pattern to copy is `lib/rate-limit.ts:60-64`.
- Healthcheck DB ping: `getPool().query('SELECT 1')` (`lib/data/postgres/client.ts`).

---

## Chunk 1 — Ops lite (S total: healthcheck, retention, runbooks)

### Task 1.1 — `GET /api/status` liveness endpoint
New route: no auth, returns `{ ok: true, db: 'up', version }` after `getPool().query('SELECT 1')` raced against a 3s timeout; on failure returns 503 `{ ok: false, db: 'down' }`. Never leak connection details. Light rate limit (`status:${ip}`, 30/min). Version = `CHANGELOG[0].version` import. **Verify:** `curl` 200 with DB up; stop local Postgres → 503 within ~3s. Then (user step, documented in the route comment): point an external uptime monitor at it.

### Task 1.2 — `oura_heartrate` retention
In the adapter's `upsertOuraHeartrate`, after a successful insert batch, run the throttled fire-and-forget prune (copy `lib/rate-limit.ts:60-64`, module-level `lastPrune`, 24h throttle): `DELETE FROM oura_heartrate WHERE timestamp < now() - interval '180 days'`. 180 days keeps two mesocycles of workout HR detail; the derived per-session stats live elsewhere and are unaffected. **Verify:** unit-testable if the prune is extracted as a pure-SQL helper; otherwise insert an old row locally, trigger a sync write, confirm deletion.

### Task 1.3 — Runbooks: DB backup/restore + account recovery
- `docs/runbooks/db-backup-restore.md`: Railway snapshot state (check the dashboard, document what's actually enabled), manual `pg_dump`/`pg_restore` commands against the Railway URL, restore-to-new-instance walkthrough, and a recommended cadence note. Optional `scripts/db-backup.sh` wrapping the dump with a datestamped filename.
- `docs/runbooks/account-recovery.md`: the lockout scenario (credentials forgotten + Google grant revoked) and the recovery path — `scripts/reset-password.js` (new: takes email + new password, writes a bcrypt hash via `DATABASE_URL`, mirroring the seed script's hashing) run from a Railway shell. No UI flow — single-user app; a web reset flow without email infra would weaken security for nothing.
- Link both from CLAUDE.md's environment section is **not** needed — link from `projectOverview.md`'s Document Map instead.

**Verify:** run `scripts/reset-password.js` against the local dev DB and log in with the new password.

## Chunk 2 — Observability + version (M: error capture, admin tab, update prompt, push proof)

### Task 2.1 — Migration 109: `error_events` table
`id, user_id (nullable FK), source ('client'|'server'), message, stack, url, user_agent, created_at` + index `(created_at DESC)`. Prune >30 days opportunistically on insert (same throttled pattern as Task 1.2).

### Task 2.2 — Capture paths
- **Client:** a small `ErrorReporter` client component mounted once in `app/layout.tsx`: `window.addEventListener('error')` + `'unhandledrejection'`, dedupe by message within the session, batch/throttle (max ~5 reports/min client-side), `navigator.sendBeacon`/`fetch` to `POST /api/client-error`. The route: auth required, `readJsonLimited` 16KB, `rateLimit(\`client-error:${userId}\`, 10, 60_000)`, insert into `error_events`. Fail-closed on oversized/malformed input.
- **Server:** `lib/observability.ts` exporting `reportServerError(err, context)` (inserts fire-and-forget, never throws). Adopt it in the catch blocks of the highest-risk routes only — `sync/push`, `log-exercise`, the AI routes (via `lib/ai/retry.ts`'s failure path), `oura/sync` — not a blanket 69-route sweep. Wire the dead `lib/error-handler.ts` in or delete it (decide at implementation: if `handleApiError` gains `reportServerError`, adopt it in those same routes; otherwise remove the file).
- **Root error boundary:** add `app/error.tsx` (branded retry card — this also closes the G3 item) reporting via the same POST.

### Task 2.3 — Admin "Errors" tab
Add `'errors'` to the `Tab` union + tab array in `app/admin/admin-content.tsx`; new `GET /api/admin/errors` (requireAdmin, last 100, newest first) rendered as a simple list (time, source, message, expandable stack). Follow the existing tab-body pattern.

### Task 2.4 — `GET /api/version` + APK update banner
Route returns `{ version: CHANGELOG[0].version }` (public, cacheable `max-age=300`). Client: on More/Profile mount (native only — guarded dynamic import of `@capacitor/app`), compare `App.getInfo().version` to the endpoint; if behind, show an amber "Update available — vX.Y.Z" card linking to the existing `/api/download-apk` flow. Web/PWA is excluded (sw.js handles it). **Verify:** mock `App.getInfo` in a unit test for the compare helper; on-device check listed as the standard ⚠️ APK step.

### Task 2.5 — Prove the push path end-to-end (wire-or-delete resolution: **keep + prove**)
- Fix the 410-cleanup bug in `sendPushToUser` (currently deletes only the first expired subscription per cycle — collect all expired and delete each).
- New `POST /api/push/test` (auth, rate-limited 3/hr) calling `sendPushToUser(userId, {title:'TrainingAI', body:'Test notification'})`; a "Send test notification" button next to the existing push toggle in `profile-tab.tsx`.
- Real triggers stay deferred to E6's cron layer (anomaly alerts, digests) — with no cron, in-app events all fire while the user is looking at the app. Document this decision in the route comment.

**Verify (chunk 2):** dev server — throw a test error in a client component → appears in Admin > Errors; `curl /api/version`; push test button delivers on a real browser subscription (VAPID keys required — if absent locally, verify the 503 path + unit-test `sendPushToUser` cleanup logic).

## Chunk 3 — Export + parity tests (M)

### Task 3.1 — `GET /api/export` full-data takeout
Auth-gated, `rateLimit(\`export:${userId}\`, 2, 60*60*1000)`. Streams NDJSON via `ReadableStream` (first row-streaming route — keep it dependency-free): one `{domain, row}` line per record, iterating the repo's per-domain list getters (programs/styles/schedules, workout sessions + exercise/set logs, personal records, body metrics, sleep, mood, day check-ins, food logs + items + meal types, supplements + logs, injuries, activity logs, oura_daily/tags, goals). `Content-Disposition: attachment; filename=trainingai-export-<date>.ndjson`. A "Export my data" row in Profile → data section triggers the download. Do **not** include tokens/credentials tables. **Verify:** download against the seeded local DB, line-count per domain matches DB counts, file opens/parses.

### Task 3.2 — `pushMutations` ↔ web-route parity tests
New integration suite (vitest) running only when `DATABASE_URL` points at the local dev Postgres (skip cleanly otherwise so CI stays green): for `mood_logs`, `session_rpe`, `day_checkins`, `food_logs` — push a mutation through `repo.pushMutations` and the same payload through the web route handler, assert identical resulting rows (defaults, clamps, ownership scoping) and that invalid payloads are rejected by **both** paths. This regression-proofs the documented drift class (#47/#74/#82) and locks in the Task 2 clamps from the review quick-fixes plan. **Verify:** suite green against `pnpm db:local`; deliberately re-introduce the sleepQuality-default drift locally and watch it fail.

---

**Done when:** each chunk lands as its own green PR with dev-server verification; entry removed from `docs/implementation-backlog.md` when chunk 3 merges (annotate partial completion if chunks land across sessions). Not exercisable in-sandbox: real push delivery to a device, Railway snapshot verification, on-device APK version check — list these in each PR.
