## 2026-07-22 — D1 client batch (part 2): oura_daily_summary/derived local applyDelta persistence

**Branch:** `claude/oura-ondevice-hybrid-phase-2-f4ahnd` — Phase-2 durability client batch, completing the
restore data path #756 started. Client code — **device-gated** (`getLocalStore` null on web); compile +
mock-SQL unit-verified. No version bump (dormant — no local reader consumes these yet).

### What shipped
Restore now populates **all four** day-grained finished-form domains locally, not just sleep + `oura_daily`:
- **`oura_daily_summary` local `applyDelta`** — 29 scalar columns (raw physiology + the flat `*_baseline_*_x8`
  EMA state + `n_history`). Server emits them via a curated `db.select({...})` projection with a `date AS day`
  alias, all scalar (no JSON). Guarded upsert on `day` mirroring #756's `oura_daily` pattern.
- **`oura_daily_derived` local `applyDelta`** — 33 data columns via the authoritative `DERIVED_COLS` set.
  The **7** JSON columns (`model_versions, sleep_contributors, readiness_contributors, activity_contributors,
  illness_biomarkers, chronic_stress_contributors, body_comp`) arrive stringified on the wire → parsed to
  objects in the mapper, re-stringified on write (matching the `oura_daily.contributors` round-trip).
  `training_load_high` (boolean) is stored `0/1`; `resilience_granular` is a plain REAL (not JSON). Guarded
  upsert on `day`.
- New `LocalOuraDailySummary` / `LocalOuraDailyDerived` types; `applyDelta` interface + sync-engine pull
  mappers + the `applyDelta({...})` call + `count` all extended.

### Why (not dormant forever)
This completes the finished-form restore set so a wipe→restore rebuilds the **complete** device-computed
history (readiness/illness/resilience/body-comp + baselines), not a partial one — and it's the prerequisite
for the D3 local-first read-flip (when the readiness/health screens read local instead of server, the data
is already there). Persisting server responses locally on pull is the offline-first hydrate rule.

### Verification (sandbox — compile + mock-SQL)
- New `sqlite-backend.test.ts` cases: summary upsert is `day`-conflict clobber-guarded + carries the
  baseline/physiology/`n_history` columns + real param values; derived upsert clobber-guards, stringifies the
  7 JSON columns, stores the boolean as `0/1` (asserts no raw boolean is bound), keeps `resilience_granular`
  a REAL. 59 `lib/local-store`+`lib/sync` tests green.
- `tsc`: only the 2 pre-existing `onnxruntime-web` errors; changed-file eslint 0 errors; `check-reconcile`
  (no new columns — the v17 local tables already exist) + `check-push-mutations` green.
- **NOT verified on device:** the actual local SQLite writes on the S25 — dormant until a local reader / the
  D3 read-flip. Folded into the existing restore Known-Issues row; the wipe→restore RST proof now validates
  these domains too.
