# Fix: bound the BLE rollup (statement-timeout cliff) + adopt the retention posture (C-1/H-2 merged)

**Source:** deep review `docs/reviews/2026-07-18-deep-app-review.md` §C/§H (C-1 = H-2 adversarially
verified REAL/high with C-2 folded in as medium; H-1, H-3, H-5, K6, G-6; §H Design notes hold the
full retention proposal). Serial-track item — owns `aggregateOuraRawSamples` in
`lib/data/postgres/adapter.ts`. Branch: `fix/ble-rollup-efficiency`.

## Problem

`aggregateOuraRawSamples` is a **full-history rollup fired once per 255-event ingest POST**:

- `rowsByTags` has no ds/measured_at lower bound (`adapter.ts:3989-3998`) — every run reads all
  ~300k+ raw rows for the user;
- post-Lever-1a rows store `decoded = NULL`, so each run hex-decodes ~455k bodies **in JS**;
- SleepNet (ONNX) re-runs per historical night per invocation — no new-night gating;
- ~150 runs/day, 60–100 during the morning catch-up drain (`app/api/oura-ble/samples/route.ts:70-85`);
- the verified trajectory hits the pool's `statement_timeout` (15s) around **Sep–Oct 2026**, at
  which point the rollup dies silently (console-only, K6) while raw ingest keeps succeeding —
  health screens freeze exactly like the BLE-3/4 incident;
- `0x50` is missing from the ingest trigger tag-set (C-2/G-3 note), so pure-0x50 batches skip the
  rollup they should trigger.

Retention gaps verified alongside (§H): `rr_intervals` is unbounded with a single
live-compute-only consumer (H-1); the 180d `oura_heartrate` prune will start silently erasing
per-workout HR stats its own comment claims are persisted (H-3, first real loss ~Jan 2027, strap
data unrecoverable); prune machinery swallows errors, deletes globally (not user-scoped), and one
prune is awaited/unthrottled (H-5); `daily_zone_minutes` >180d recompute impossible (handled in P2).

## Tasks

1. **Windowed rollup:** compute only days whose raw rows changed since the last run (dirty-day set
   from the ingest batch's ds range + a stored high-water mark), with a bounded full-recompute
   admin path for redecode passes. Gate SleepNet/step ONNX inference to dirty nights only.
2. **Debounce the trigger:** coalesce per-drain (e.g. one rollup after the drain settles or ≥N s
   since last run) instead of per-POST; add `0x50` to the trigger tag-set.
3. **Surface rollup failure** (K6): failures write an `error_events` row (reuse
   `reportServerError`) — pairs with P5's standard.
4. **Retention (from §H design notes; each lever states resolution lost + consumer proof):**
   - materialize per-workout HR stats before the 180d `oura_heartrate` prune can bite (H-3), or
     lengthen that prune until they are;
   - add an `rr_intervals` retention prune after nightly rMSSD + retained workout windows are
     materialized (H-1) — throttled write-path pattern, no cron;
   - fix prune hygiene (H-5): log failures, scope deletes per-user where applicable, fire-and-forget
     the awaited one;
   - `body_hex`/Lever-5 cold-store remains **owner-decision, untouched** (tracked; do not implement).
5. **Verification:** local-DB timing harness (seed ~300k rows; assert rollup runtime bounded and
   result-identical on dirty-day vs full recompute); `pnpm test` green; dev-server drain smoke.

## Out of scope

Zone-cache invalidation (P2 task 3), Lever 5 (owner), oura_accel_chunks (already pruned 7d).
