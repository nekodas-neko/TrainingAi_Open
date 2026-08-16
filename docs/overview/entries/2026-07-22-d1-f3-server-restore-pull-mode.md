## 2026-07-22 — D1/F3 (server half): pull route `?mode=restore` + rate limiting

**Branch:** `claude/oura-ondevice-hybrid-phase-2-f4ahnd` — Phase-2 durability Foundation, task **F3**,
server half. Server-only; no user-visible change (no version bump).

### What shipped
- **`app/api/sync/pull/route.ts` accepts `?mode=restore`** → threads `windowDays: null` to
  `getSyncDelta(userId, since, null)`, skipping the 90-day recent floor so a wipe→restore drain honours
  the raw `since` (epoch = full history). The default (no `mode`) passes `undefined`, keeping the
  90-day-clamped path **byte-identical**.
- **Rate limiting added to the pull route (it had none).** Normal pulls and restore pulls get
  **separate buckets** — `sync-pull:${userId}` at 60/min (mirrors `sync-push`) and
  `sync-pull-restore:${userId}` at 120/min. Separate buckets because a resumable restore fires many
  sequential pages back-to-back: a shared bucket would let a restore burst starve the regular
  foreground sync cadence (and vice-versa), and the restore bucket must be generous enough not to break
  its own drain loop while still bounding abuse.

### Out of scope (deferred — device-gated `[D]`)
- **The client restore driver loop is NOT in this PR.** Surfacing `hasMore` on `pullDelta`'s outer
  return, fixing the `fullResync`-vs-resumable contradiction (seed the cursor to epoch **once** then
  loop on the persisted advancing cursor with `force=true, fullResync=false`), and the loop-until-
  `hasMore===false` trigger all live in `lib/local-store/sync-engine.ts` — `getLocalStore` is null on
  web, so they can only be verified on the S25. They ride with the device-gated client batch
  (A1c–A4c/F4) and the RST wipe→restore proof.

### Verification (sandbox)
- New route test `app/api/sync/pull/__tests__/route.test.ts` (6 cases, pure-mock, CI-runnable):
  401 when unauthenticated; normal pull passes `windowDays=undefined`; `mode=restore` passes
  `windowDays=null`; `since` threads through; normal vs restore hit **distinct** rate-limit keys;
  429 short-circuits before the repo is touched.
- The repo-level window semantics (`null` skips the 90-day floor, honours `since`) are already proven
  DB-backed in `lib/data/postgres/__tests__/sync-delta-window.test.ts` (F1) — re-ran green (3/3).
- `pnpm exec tsc --noEmit`: only the 2 pre-existing `onnxruntime-web` errors (not this change).
  Changed-file eslint clean; `check-push-mutations` + `check-reconcile` green.
- **Half:** server-only, sandbox-verified. Forward-compatible — existing clients send no `mode`, so
  they keep the 90-day-clamped behaviour and are unaffected by the new rate limit's headroom.
