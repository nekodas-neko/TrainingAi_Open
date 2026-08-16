## 2026-07-21 — D1/B1: Track-B timeseries server infra (server-only)

**Branch:** `claude/oura-ondevice-hybrid-5xycdr` — Phase-2 durability task **B1** (the server infrastructure
the first draft never scoped, per the entry-gate review's R1). No user-visible change; pure backup
infrastructure for the not-yet-wired Track-B sync, so no version bump.

### What shipped (server-only; sandbox-tested, CI-gated)
- **Migration 130** (`130_oura_heartrate_updated_at.sql`): adds `oura_heartrate.updated_at` (back-filled
  from `timestamp`, then `DEFAULT now() NOT NULL`) + a `(user_id, updated_at, id)` keyset index. Without
  it the Track-B delta would key on `timestamp` and a re-decoded historical point would never re-sync.
- **`upsertOuraHeartrate` → `onConflictDoUpdate`** (`slices/oura.ts`): was `onConflictDoNothing`, which
  **silently dropped a re-decoded/corrected bpm** (the B1-a blocker — `updated_at` alone doesn't fix it).
  Now updates `bpm/source` and bumps `updated_at` **only when the value actually changed** (`setWhere` with
  `IS DISTINCT FROM`), so an idempotent re-roll doesn't churn the sync.
- **Migration 137** (`137_oura_bucket_server.sql`) + `schema.ts` `ouraBucket` + **`upsertOuraBucket`**: the
  server mirror of the on-device `oura_bucket` coarse-tier RRD ladder (it existed only in local SQLite — R1).
  `bucket_start_ms/ds` are `BIGINT`; `user_id` added; forever-retained (no prune); same change-guarded upsert
  + `(user_id, updated_at, id)` keyset index. This is the durable backup destination Track-B (B2) will write.

Migration numbers 130 (free gap) + 137 confirmed free; 136 is pre-claimed by the parent raw-on-device spec.
The runner tracks applied files by name (`schema_migrations`), so back-filling 130 applies cleanly on a
prod DB already past 135.

### Verification
- `pnpm exec tsc --noEmit` 0 new errors (2 pre-existing `onnxruntime-web`); changed-file lint 0 errors;
  `check-push-mutations` / `check-reconcile` green. Migrations applied to the local dev DB.
- New DB-backed test `oura-timeseries-upsert.test.ts` (3 cases): HR insert stamps `updated_at`; an unchanged
  re-roll does NOT bump it; a corrected bpm updates the value AND advances `updated_at`; same for buckets.

### Known follow-up (recorded in the plan's B2 amendment — not an orphan)
- The **server** rollup writes `oura_heartrate` by delete-source='ble'-in-window + re-insert
  (`adapter.ts:4774→4779`), so the B1 change-guard can't stop the last ~14 days' `updated_at` churning each
  rollup. Bounded (not whole-history); B2 must decide device-sole-writer post-cutover vs accept the 14-day
  re-pull. This path is not device-gated (server-side), but the eventual Track-B **device push/pull** is.

### Next
- Track A A1: `oura_daily_summary` as a full offline-sync domain (server half sandbox-testable; the
  `applyDelta`/restore half is device-verified — `getLocalStore` is null on web).
