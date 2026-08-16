## 2026-07-21 — Oura raw-on-device: Phase 2 durability plan (docs-only)

Wrote the Phase-2 plan
(`docs/superpowers/plans/2026-07-21-oura-raw-on-device-phase-2-durability.md`) — the piece the
confirmation review flagged as "decided but not yet designed": the durability guarantee that justifies
the whole raw-on-device inversion.

**What it designs:**
- **Full-history restore** — `getSyncDelta` gains a `windowDays: number | null` (null bypasses the 90-day
  clamp), a `mode=restore` pull route, and a client restore trigger that re-hydrates a wiped/new device's
  *entire* calculated history (like iCloud/Samsung Cloud), not a 90-day slice.
- **The six-form offline sync chain** — `sleep_sessions` (add push + the missing clobber-guard),
  `oura_daily_summary`, `oura_daily_derived`, `oura_heartrate` (high-volume, batched-by-day + load-tested
  against the pool budget), `oura_bucket` coarse tiers only, and `body_metrics`/`oura_daily` Oura fields —
  each wired through the repo's 8-link template (MutationDomain → outbox → shared write fn in
  `pushMutations` → `getSyncDelta` SELECT + cursor → `SyncDelta` → clobber-guarded `applyDelta`), with the
  `check-push-mutations` shared-write-fn rule and the `body_metrics` source-merge (so Oura never stomps
  manual/Health-Connect fields) respected.
- **Single-writer cutover** — a per-user flag stands the server rollup down once the device push + restore
  is device-verified, eliminating the dual-write `COALESCE` first-writer-wins race.

Grounded in the real sync code (`getSyncDelta` 90-day clamp `adapter.ts:2971`, the `MutationDomain` enum,
the `pushMutations`/`applyDelta`/`resolveSyncCursor` chain). Sandbox-testable server halves are TDD;
client/local-store halves are device-verified. Phases 3–4 remain unplanned. No version bump (docs).

**Reviewed (3 adversarial passes) → NOT implementation-ready; a "Review Outcome" section (R1–R7) folds the
findings in.** The two day-grained score tables (`oura_daily_summary`/`oura_daily_derived`) are sound, but:
`oura_bucket` has no server table and `oura_heartrate` has no `updated_at` (R1 — unscoped infra);
intraday HR doesn't fit the shared `getSyncDelta`/outbox machinery — cursor stall on tied timestamps,
the I19 fan-out, outbox can't replace-by-day (R2 — needs a dedicated HR endpoint); the cursor needs an
`(updated_at, id)` tiebreak (R3, cross-cutting); `pullDelta`'s 20-page cap + no `hasMore` means restore
can't drain (R4); and **none of the six domains has a mark-synced arm, so a pushed row stays `pending`
forever and the clobber-guard then permanently blocks future pulls from correcting it** (R5 — the freeze).
Plus sleep restore comes back stripped of its Oura columns (R6). None reached code — the review caught it
at the plan stage, which is the point.

**Revised breakdown written (same session):** the plan now splits into two sync tracks — **Track A**
(shared-path day-grained forms: `oura_daily_summary`, `oura_daily_derived`, `sleep_sessions`,
`body_metrics`/`oura_daily`, via the 8-link template) and **Track B** (a dedicated single-connection,
timestamp-cursored endpoint for intraday HR + coarse buckets, with the server infra R1 flagged — a new
`oura_bucket` Postgres table and `oura_heartrate.updated_at` — plus a deterministic-id replace-by-day
outbox) — over **Foundation** tasks F1–F4 (the `getSyncDelta` unclamp, the cross-cutting `(updated_at,id)`
cursor tiebreak, the restore drain-loop with a real `hasMore`, and mark-synced arms for all six domains),
then a single-writer cutover and the device-verified restore proof. **Pending another agent's review
before implementation.** No version bump (docs).
