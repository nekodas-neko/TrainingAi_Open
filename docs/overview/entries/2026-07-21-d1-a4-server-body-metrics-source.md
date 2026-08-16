## 2026-07-21 — D1/A4 (server half): body_metrics push threads payload.source (latent-bug fix)

**Branch:** `claude/oura-ondevice-hybrid-5xycdr` — Phase-2 durability Track A, task **A4**, server half
(folded into the A3 PR — both small Track-A server wirings). Server-only; no user-visible change.

### What shipped
- **`body_metrics` push branch** no longer hardcodes `source='manual'` — it threads the payload's source
  (whitelisted to a known `HealthSource`, default `'manual'`). This fixes a **live latent bug**: an
  `oura_ble`/`health_connect` body_metrics push was misfiled as rank-4 `manual`, so a ring push would
  **stomp a genuine manual weight** via `mergeSet` (rank equal/higher wins). Now the ring writes at rank 3
  and the per-field merge preserves manual (rank 4) values. The web/hand-entry path sends no source →
  defaults to `manual` (unchanged).

### Out of scope (deferred to the client batch)
- `oura_daily` push arm: the local `oura_daily` table has **no `sync_status`** column and the review's
  named field `non_wear_time_sec` is a **phantom** (doesn't exist locally) — so the `oura_daily` push +
  clobber-guard is deferred to the device-gated client batch where the `sync_status` column is added and
  the real BLE-authored field(s) resolved.
- `active_calories` stays routed via `oura_daily` only (no local `body_metrics` column) — no change here.

### Verification
- `pnpm exec tsc --noEmit` 0 new errors; changed-file lint 0 errors; `check-push-mutations` green.
- New DB-backed test `body-metrics-push-source.test.ts` (3 cases): an `oura_ble` push does NOT stomp a
  prior manual weight (but fills a manual-untouched field); a push with no source defaults to `manual`;
  an unknown source string is whitelist-rejected → `manual`.
- **Half:** server-only. Fully forward-compatible — existing clients push body_metrics without a `source`
  field, so they keep writing `manual` exactly as before.
