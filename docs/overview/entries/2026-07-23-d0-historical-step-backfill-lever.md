## 2026-07-23 — D0: historical step backfill lever (`allowStepsDecrease`)

**Branch:** `claude/oura-ondevice-hybrid-5xycdr`. Adds the mechanism for the owner-gated historical
step correction flagged as deferred when D0 shipped (v1.196.0) and again when the column-order 0-bug
was fixed (v1.203.1/#755). **Code-only — off by default, no effect until explicitly invoked.** No
version bump (no user-visible behaviour change).

### Why
The rollup's `steps` step has a deliberate max-merge guard: `step_counter` can only ever *raise* a
stored day's count, never lower it — this made the D0 forward-flip non-destructive from day one. The
consequence: it also can't correct the old, inflated flat-30-estimate values already stored under
`oura_ble` for historical days. That correction needed a separate, explicit, owner-confirmed lever —
now that the column-order fix is verified on-device (owner's counted 100-step walk → ~99 measured in
the matching window), it's time to build it.

### What shipped
- **`aggregateOuraRawSamples` gains `allowStepsDecrease?: boolean`** (repository interface + adapter).
  When `true`, the steps step's `mergedSteps > existingSteps` guard is bypassed — the corrected total
  is always offered.
- **Safety is NOT the bypassed guard — it's the existing sourceMap rank merge.** The write still goes
  through `upsertBodyMetrics(userId, rows, 'oura_ble')`, which applies the per-field `mergeSet` rank
  comparison unconditionally: a `manual` entry (rank 4) is preserved regardless of this flag, because
  `oura_ble` only ranks 3. This flag never touches manually-entered or otherwise higher-ranked steps —
  verified by test.
- **Wired into the existing admin redecode route** (`POST /api/oura-ble/samples/redecode`), not a new
  route: `?allowStepsDecrease=1` alongside the existing `fullHistory: true` redecode path. Reuses
  already-proven infra (admin-gated, rate-limited 4/60s, "keep it rare") rather than duplicating it.

### Verification
- `pnpm exec tsc --noEmit` 0 new errors; changed-file lint 0 errors; `check-push-mutations` /
  `check-reconcile` green.
- New DB-backed test `oura-ble-step-backfill.test.ts` (3 cases): default behaviour unchanged (guard
  still blocks a decrease without the flag); with the flag, an inflated `oura_ble` value IS
  overwritten; a higher-ranked `manual` entry is preserved even with the flag set. **83 step/rollup
  tests pass** across the full suite.
- `pnpm dev`: the route compiles and serves (401 auth — no import/compile error) with the new query
  param present.

### Still to come — the actual owner-confirmed execution
This PR only builds the capability; it does **not** run it. Firing `?allowStepsDecrease=1` against
production is the destructive step (rewrites historical `body_metrics.steps` for every `oura_ble`-
sourced day) and requires the owner's explicit go-ahead per session, presented separately with the
exact scope of what will change.
