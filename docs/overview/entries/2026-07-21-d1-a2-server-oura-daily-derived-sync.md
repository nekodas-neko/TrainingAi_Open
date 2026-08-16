## 2026-07-21 — D1/A2 (server half): oura_daily_derived offline-sync domain

**Branch:** `claude/oura-ondevice-hybrid-5xycdr` — Phase-2 durability Track A, task **A2**, server half.
Makes `oura_daily_derived` (the device-computed scored/analysis outputs — illness, resilience, chronic
stress, readiness/sleep/activity scores, body-comp, BDI, …) a bidirectional offline-sync domain for the
Railway backup + restore. Server-only; no user-visible change; no version bump.

### What shipped (server; sandbox-tested, CI-gated)
Mirrors A1, with three real divergences the mapping surfaced:
- **COALESCE, not full-set.** The shared `upsertOuraDailyDerived(userId, day, patch)` is a partial
  COALESCE upsert (a null field never clobbers a good stored value), so the push branch passes the whole
  33-field patch with nulls for absent fields — safe. Keyed on `day` (no `date`→`day` alias needed).
- **7 JSONB columns** (`model_versions`, the four `*_contributors`, `illness_biomarkers`, `body_comp`):
  `getSyncDelta` stringifies them for the client's TEXT mirror; the push branch `JSON.parse`s them back.
- **Nothing to add on the write side** — the slice fn, adapter wrapper, and repository-interface method
  already existed (the derived table has had live server writers since Sub-plan A). A2 adds only the
  `MutationDomain`/`SYNCED_MUTATION_DOMAINS`/`DOMAIN_LABELS` entries, the `pushMutations` branch, and the
  `getSyncDelta` pull (destructure + query + cursor page + `SyncDelta` member).

**Field-coverage tripwire:** `DERIVED_COLS` is now exported; the test asserts the push payload covers every
derived column, so a future column added there without updating the push branch fails CI (the recurring
"missed a column" bug class — the derived table is assembled from **9** separate writers).

### Verification
- `pnpm exec tsc --noEmit` 0 new errors (2 pre-existing `onnxruntime-web`); changed-file lint 0 errors;
  `check-push-mutations` green; **122 postgres+sync tests pass**.
- New DB-backed test `oura-daily-derived-sync.test.ts` (4 cases): push parses the JSONB + lands the row;
  `getSyncDelta` returns it JSONB-stringified for the mirror; the field-coverage tripwire; and the COALESCE
  guard (a partial re-push updates only its fields and never nulls the rest).
- **Half:** server-only. The pull member is optional and the client ignores it until the client half →
  inert + forward-compatible.

### Next
- A3-server (`sleep_sessions` push via the shared `upsertOuraSleep` with `source='oura_ble'`) and A4-server
  (`body_metrics` — fix the `source='manual'` hardcode to thread `payload.source`; `oura_daily`). Then the
  batched **device-gated client halves** (applyDelta + F4 mark-synced + restore mapper) for the S25.
