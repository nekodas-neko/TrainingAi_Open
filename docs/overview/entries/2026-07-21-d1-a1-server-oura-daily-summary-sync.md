## 2026-07-21 — D1/A1 (server half): oura_daily_summary offline-sync domain

**Branch:** `claude/oura-ondevice-hybrid-5xycdr` — Phase-2 durability Track A, task **A1**, server half.
Makes `oura_daily_summary` (the device-computed nightly physiology + rolling EMA baselines) a
bidirectional offline-sync domain so it can be **backed up to Railway and restored to a wiped phone**.
Server-only; no user-visible change (the client push/apply half isn't wired yet), so no version bump.

### What shipped (server; sandbox-tested, CI-gated)
The push side mirrors `body_metrics`; the pull side mirrors the existing `oura_daily` domain.
- **`MutationDomain` + `SYNCED_MUTATION_DOMAINS`** += `'oura_daily_summary'` (the canonical list the push
  envelope enum + local `PendingMutation['domain']` both derive from — a domain queued but absent here is
  the D-1 silent-drop bug). `DOMAIN_LABELS` in the sync-health card updated.
- **`pushMutations` branch** → delegates to the shared **`upsertOuraDailySummary`** (window-scoped single-row
  upsert — NOT `replaceOuraDailySummary`, which deletes all rows and would wipe history on every pushed
  night). Reassembles the six `BaselineStateRow` objects from the flat `*BaselineMeanX8/*BaselineDevX8`
  payload fields. Added the adapter wrapper + repository-interface method (the slice fn already existed).
- **`getSyncDelta` pull**: new `oura_daily_summary` SELECT (server `date` → client `day`; cursor on
  `updated_at`) carrying **every** column incl. the `*_baseline_*_x8` + `n_history` EMA state, its
  `resolveSyncCursor` page entry, and its `SyncDelta` member.

The server tables already exist (`oura_daily_summary` server table + v17 local mirror both carry
`updated_at` + all baseline columns) — no migration needed. `check-push-mutations`/`check-reconcile` green
(the branch calls the shared fn, never `this.db`/raw sql).

### Verification
- `pnpm exec tsc --noEmit` 0 new errors (2 pre-existing `onnxruntime-web`); changed-file lint 0 errors;
  **118 postgres+sync tests pass**.
- New DB-backed test `oura-daily-summary-sync.test.ts` (3 cases): push lands every metric + baseline column;
  `getSyncDelta` returns the row with baselines intact under BOTH the default 90-day window and full-history
  restore (`windowDays=null`); a second same-day push upserts in place (no duplicate, history-safe).
- Half-wired safely: the pull returns `ouraDailySummary` (optional member) which the client currently
  ignores (no `applyDelta` branch yet); no client pushes it yet (no `queueMutation` wiring). Inert +
  forward-compatible until A1-client.

### Next — A1-client (⚠ DEVICE-GATED, `getLocalStore` null on web)
The local `store.upsertOuraDailySummary` + `queueMutation` at the on-device rollup write site, the
`applyDelta` branch with the `sync_status='synced'` clobber-guard, and the **F4 mark-synced arm** (without
it a pushed row freezes `pending` forever). Implement + flag NOT-verified for the S25 (a pushed rollup row
must end `synced` and survive a later pull; the full-history restore returns the baselines intact).
