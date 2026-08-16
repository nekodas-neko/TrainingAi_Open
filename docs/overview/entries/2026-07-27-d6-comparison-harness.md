# 2026-07-27 — D6: Polar H10 comparison harness

Branch: `claude/oura-ondevice-hybrid-5xycdr` · v1.212.0

## Why

Master plan for the Oura on-device hybrid work sequences **D6 → D5 → D2**, not straight to D2. D5
(own daytime-HRV) must land before D2's neural WASM port, so dHRV is never ported to WASM only to be
deleted right after — and D5's validation gate is D6 (the H10 spot-check), not dHRV, since validating
our replacement against the thing it replaces would just re-anchor us to Oura's opinion. So D6 has to
exist before D5 can be graded. Plan:
[`docs/superpowers/plans/2026-07-26-d6-polar-h10-comparison-harness.md`](../../superpowers/plans/2026-07-26-d6-polar-h10-comparison-harness.md).

## What shipped

**`lib/oura-comparison-harness.ts`** — generic "ours vs reference" comparator. `runComparison`
takes an adapter (metric name, unit, tolerance band, two async point-series functions) and calls
both concurrently; `mergeComparisonPoints` (exported separately, pure, no I/O) outer-joins the two
series by `bucketStart`, scores each fully-populated bucket against the tolerance band, and rolls up
a summary (`withinCount`/`outOfBandCount`/`meanAbsDelta`). A bucket with only one side present stays
in `points` with a `null` on the other side, excluded from scoring rather than dropped.

**`lib/oura-comparison-harness-adapters.ts`** — the v1 adapter: ring HR vs Polar H10 HR. Both
already land in `oura_heartrate`, distinguished only by `source` (`'ble'` = ring, `'chest_strap'` =
H10) — confirmed while writing the plan that no new ingest work was needed, so this PR is purely the
harness + one thin repo read + admin surface. `bucketHrToMinuteMeans` buckets raw `{timestamp, bpm}`
rows to 1-minute means, keyed by the minute's ISO start.

**`getOuraHeartrateBySource`** (new repo method, `lib/data/repository.ts` +
`lib/data/postgres/adapter.ts`) — `oura_heartrate` rows for one user/source/window. Checked
`getOuraTimeseriesDelta` first (Track-B's cursor-based sync pull) — not reusable, it's a full-sync
cursor walk, not a windowed-by-source read, so this is a genuinely new query, not a duplicate.

**`GET /api/oura-ble/comparison-harness`** — admin-gated (`requireAdmin` → 403, `rateLimit`
20/min), `?minutes=` (default 15, matching the plan's "intermittent spot-check burst" framing) or
`?start=&end=` for a specific past window. Follows the `daytime-coverage/route.ts` template exactly.

**`components/oura-ble/comparison-harness-console.tsx`** — window picker, "Compare" button, a
summary line (`N/M within ±5bpm, mean |Δ| = X bpm`), and a per-minute `ours / reference / Δ` table
with out-of-band rows flagged (⚠). Wired into `/admin/oura-ble` next to the other consoles, following
the existing fetch-on-demand `<pre>`-log pattern (not continuous polling).

## Verification

- `mergeComparisonPoints` unit tests: within-tolerance, out-of-tolerance, missing-one-side (kept in
  `points`, excluded from scoring), sort order, empty-input — all pure, no DB.
- `bucketHrToMinuteMeans` unit tests: same-minute averaging, cross-minute split, empty input.
- `getOuraHeartrateBySource` DB-backed test against local Postgres: source filter, window filter,
  the other source stays unmixed.
- `tsc --noEmit`, `eslint` (targeted files) clean; `check-push-mutations`/`check-reconcile` OK (this
  domain has no local-store/outbox involvement — server-only admin read).
- **Sandbox end-to-end against local Postgres via `pnpm dev`:** flipped the seeded `test@local.dev`
  user to admin, inserted 15 minutes of synthetic `ble`/`chest_strap` HR rows, confirmed
  `GET /api/oura-ble/comparison-harness?minutes=20` returns a correctly-bucketed, correctly-scored
  real comparison (200), confirmed `401` for an unauthenticated request, and confirmed the
  `/admin/oura-ble` page renders the new console. Reverted the admin flag and synthetic rows
  afterward so the local dev DB matches the original seed.

## What was NOT exercised

**This is admin-only BLE-adjacent tooling — the one verification that matters most did NOT happen:**
a real H10 spot-check burst (wearing both the ring and the strap together for ~15 min, then running
the console against that window). Per the plan's own gate, that run **is** the point of D6 — it's the
first real signal on whether the ring's own HR is trustworthy, not just a "does it crash" check. The
±5bpm tolerance band is a first tripwire, not a validated threshold; it should be tuned from that
run's real data, not treated as settled. Flagged in `projectOverview.md` Known Issues.

## Next

D5 (own daytime-HRV) is next per the master plan's D6 → D5 → D2 ordering, and needs its own plan doc
written first — not implemented in this PR.
