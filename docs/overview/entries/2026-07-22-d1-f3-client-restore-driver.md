## 2026-07-22 — D1/F3 client: restore driver loop + "Restore from cloud" button (v1.200.0)

**Branch:** `claude/oura-ondevice-hybrid-phase-2-f4ahnd` — Phase-2 durability Foundation, task **F3**,
client half. Pairs with the F3-server `?mode=restore` route already on `main` (#752). Client code —
**device-gated** (`getLocalStore` null on web); the driver logic is unit-tested, the SQLite round-trip is not.

### What shipped
- **`pullDelta(userId, force, fullResync, restore=false)`** — new `restore` param appends `&mode=restore`
  to the pull fetch (server unclamps the 90-day floor → full history) and the outer return now surfaces
  **`hasMore`** (was dropped; only the inner `pullPage` had it). A later-page failure returns
  `hasMore: true` so a restore resumes from the persisted cursor rather than reading as drained. The
  `fullResync` path and every existing caller are untouched (backward-compatible — they ignore `hasMore`).
- **`restoreFromCloud(userId, onProgress?)`** — the driver: seeds the sync cursor to epoch **once**, then
  loops `pullDelta(force=true, fullResync=false, restore=true)` across the 20-page-per-call cap until the
  server reports `hasMore=false`. Resumable (each page persists the advancing cursor via `setLastSyncAt`),
  and it clears pull backoff on entry so a recent transient failure doesn't silently no-op a deliberate
  restore. This is the review's fullResync-vs-resumable fix — epoch-once, then advance the persisted
  cursor, never re-seed epoch per call.
- **"Restore from cloud" button** (More → profile, beside Sync now) — calls `restoreFromCloud`, toasts the
  restored count; on web (no native SQLite) toasts "needs the app". This is the trigger the owner uses for
  the RST device proof.

### Scope note
Drains the **shared day-grained** delta (sleep/oura_daily/body_metrics/…). The high-volume Track-B
time-series (intraday HR, coarse buckets) restore through the dedicated `/api/sync/oura-timeseries`
endpoint via a **separate** driver — not wired yet (Track-B client work, D2-adjacent).

### Verification (sandbox — unit only)
- `sync-engine.test.ts` (+4 cases, mock fetch/store): `restore=true` hits `&mode=restore` (normal pull
  does not); `hasMore` surfaces on the outer return so a loop can drain past the page cap;
  `restoreFromCloud` seeds epoch once + every drained pull carries `mode=restore`; a dead-network pull
  breaks the loop (resumable, no spin). 10/10 sync-engine, full `lib/local-store`+`lib/sync` green.
- `tsc`: only the 2 pre-existing `onnxruntime-web` errors; changed-file eslint 0 errors.
- **NOT verified on device (the RST gate):** the actual wipe→restore round-trip on the S25 — full
  sleep/HRV/RHR/score history returns (not a 90-day slice), driven by the new button. `docs/device-smoke-checklist.md`
  + a Known-Issues row.

### User-visible → bumped
`package.json` 1.199.1 → **1.200.0** (minor, new feature) + `lib/changelog.ts` entry (the Restore button +
sleep-with-HRV/stages restore from #756).
