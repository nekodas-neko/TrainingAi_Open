# D6 — Polar H10 comparison harness (implementation plan)

**Status:** planning doc for the implementer session. Read
[`2026-07-21-oura-ondevice-hybrid-master-plan.md`](2026-07-21-oura-ondevice-hybrid-master-plan.md) §D6 and
[`2026-07-21-oura-decoupling-and-own-models-strategy.md`](2026-07-21-oura-decoupling-and-own-models-strategy.md)
§4 first — this plan turns those two sections into a concrete, scoped task breakdown. Do not re-derive the
rationale here; this doc is the "how", those are the "why".

## Why this is next (not D2)

The master plan's dependency graph sequences **D6 → D5 → D2**, not D0/D1 → D2 directly. D5 (own daytime-HRV)
must land *before* D2's neural WASM port so dHRV is never ported to WASM only to be deleted right after — and
D5's validation gate is D6 (the H10 spot-check), not dHRV (validating our replacement against the thing it
replaces re-anchors us to Oura's opinion). So D6 must exist before D5 can be graded, and D5 must exist before
D2's neural-port task can start. Jumping to D2 now would violate the plan's own explicit ordering.

## What already exists (verified 2026-07-26, do not re-build)

- **Polar H10 BLE integration — real, wired end-to-end.** `android/app/src/main/java/com/trainingai/app/polar/PolarGattClient.kt` + `PolarProtocol.kt` (native), `lib/live-hr/chest-strap-source.ts` + `hr-measurement.ts` (0x2A37 HR-service parser) + `paired-strap.ts` (JS), pairing UI `components/settings/chest-strap-pairing.tsx`. Knowledge base: `.agents/skills/polar-h10-ble/SKILL.md`.
- **Both HR sources already land in the SAME table, already distinguished by `source`.** `oura_heartrate`
  (migration 130, `schema.ts:750`) holds **both**: `source='ble'` = ring-derived, 5-minute-binned, written
  by the server rollup (`adapter.ts:5072-5084`, `hrSeriesRows`/`hrSeriesBins`); `source='chest_strap'` =
  H10-derived, ~1 sample/30s in ambient mode or ~1 Hz during a workout (thinned client-side, see
  `chest-strap-source.ts:35-39`), written live by `POST /api/hr-ingest` (`app/api/hr-ingest/route.ts:53`)
  the moment the H10 is paired and worn — **no new ingest work needed for v1**, both sides are already
  populated whenever the owner wears both devices. `rr_intervals` (migration 124) also gets written by the
  same `hr-ingest` call (beat-level RR) but is **not needed for v1** — `oura_heartrate(source='chest_strap')`
  already has ready-to-use bpm values at a finer grain than the ring's 5-min bins, so deriving bpm from raw
  RR intervals would be unnecessary extra work for the v1 adapter.
- **Admin console pattern** — `app/admin/oura-ble/page.tsx` hosts a family of single-purpose consoles (`SleepNetDumpConsole`, `StepCounterExportConsole`, `RingBatteryConsole`, `LiveHrTestConsole`, …), each a client component + a dedicated admin-gated rate-limited API route. Follow this pattern exactly, not a new pattern. Reference route template: `app/api/oura-ble/daytime-coverage/route.ts` (auth → `requireAdmin` → `rateLimit` → repo call).

## What does NOT exist (this plan builds it)

A generic "ours vs reference" comparator has zero code today (verified: no hits for `withinTolerance`,
`toleranceBand`, `reference adapter`, or any registry-shaped comparator anywhere in the repo).

## Scope for this PR (v1 — keep it small)

Per the strategy doc's own framing, the harness is "thin, generic, reference-pluggable" — but a first PR only
needs **one real adapter wired**, not all the illustrative examples in the strategy doc's prose (SleepNet
stages / step_counter / H10 were listed as examples of what the registry *could* plug in, not a v1 checklist).
The master plan's D6 gate is specifically: **"H10 spot-check wired as an admin test instrument."** Build that
one adapter for v1; the registry shape stays open for more later (D5 will likely register a
daytime-HRV-vs-H10 adapter when it lands — do not build that adapter now, D5 isn't done).

**v1 adapter: ring-derived HR vs Polar H10 HR**, bucketed per-minute over an admin-selected time window
(e.g. "last N minutes" during a live spot-check session, since the H10 is worn for short bursts, not
continuously — per the master plan's "intermittent spot-check" framing).

### 1. Generic comparator core — `lib/oura-comparison-harness.ts` [S]

```ts
export interface ComparisonPoint { bucketStart: string; ours: number | null; reference: number | null }
export interface ComparisonResult {
  metric: string
  unit: string
  toleranceBand: number       // absolute; a point is withinTolerance if |ours - reference| <= toleranceBand
  points: ComparisonPoint[]
  summary: { withinCount: number; outOfBandCount: number; meanAbsDelta: number | null }
}

export interface ComparisonAdapter {
  metric: string
  unit: string
  toleranceBand: number
  ours(userId: string, startIso: string, endIso: string): Promise<ComparisonPoint[]>       // {bucketStart, ours}
  reference(userId: string, startIso: string, endIso: string): Promise<ComparisonPoint[]>  // {bucketStart, reference}
}

export function runComparison(adapter: ComparisonAdapter, ...): Promise<ComparisonResult>
```

Merge `ours`/`reference` points by `bucketStart` (outer join — a bucket with only one side present carries a
`null` on the other and is excluded from `withinTolerance` scoring, not silently dropped from `points`).
Compute `withinTolerance` per merged point, roll up the summary. Pure function, no I/O beyond the two
adapter calls — keep it testable without a DB.

### 2. H10-vs-ring HR adapter — `lib/oura-comparison-harness-adapters.ts` [S]

Both sides read from the **same table**, filtered by `source` — no derivation needed:
- `ours`: `SELECT timestamp, bpm FROM oura_heartrate WHERE user_id=$1 AND source='ble' AND timestamp BETWEEN $2 AND $3`, bucketed to 1-minute means.
- `reference`: same query with `source='chest_strap'`, same bucketing.
- `toleranceBand`: start at **±5 bpm** (a reasonable first tripwire per the "tripwire not sameness"
  philosophy — tune later from real spot-check data, do not hand-wave a tighter number now).
- Repository method: check `lib/data/repository.ts` for an existing HR-window-by-source read (Track-B's
  `getOuraTimeseriesDelta`/B2 work queries `oura_heartrate` by window already — check whether it can be
  reused or needs a thin `source`-filtered sibling) before adding a new one; don't duplicate a query the
  codebase already has close to this shape.

### 3. Admin API route — `app/api/oura-ble/comparison-harness/route.ts` [S]

Follow the `daytime-coverage/route.ts` template exactly: `auth()` → `requireAdmin` → `rateLimit` →
call `runComparison` with the H10-vs-HR adapter → return `ComparisonResult` JSON. Query params: `minutes`
(window length, default 15 — matches a short spot-check burst), or `start`/`end` ISO if a specific past
window is more useful for re-running against an already-captured spot-check.

### 4. Admin console component — `components/oura-ble/comparison-harness-console.tsx` [S]

Follow the existing console component pattern (see `ring-battery-console.tsx` or `live-hr-test-console.tsx`
for the closest shape — a fetch-on-demand panel, not continuous polling). Show: window picker, "Run
comparison" button, summary line (`N/M within ±5bpm, mean |Δ| = X bpm`), and a simple table or sparkline of
per-bucket ours/reference/delta, with out-of-band rows visually flagged. Wire into
`app/admin/oura-ble/page.tsx` next to the other consoles.

### 5. Tests [S]

- `runComparison` unit tests: within-tolerance / out-of-tolerance / missing-one-side-of-a-bucket cases —
  pure function, no DB needed.
- If a new repo method is added for the HR-window read, a DB-backed test following the existing
  `lib/data/postgres/__tests__/` pattern (skips without `DATABASE_URL`, matches this session's local-Postgres
  setup).

### Gate (per the master plan's D6 section)

- Sandbox: `runComparison` unit tests pass; `tsc`/`eslint`/`check-push-mutations`/`check-reconcile` clean.
- **Device-verified**: the owner does a real H10 spot-check burst (wear both ring + strap for ~15 min), runs
  the admin panel against that window, and confirms it shows a real per-minute comparison (not just "no
  crash" — the numbers must be physiologically plausible and the two sources roughly agree, since this run
  itself doubles as the first real signal on whether the ring's own HR is trustworthy). Flag as
  NOT-verified in `projectOverview.md` until that happens (Canonical Runtime rule — this touches a
  BLE/native data source, on-device is the only real check).
- No live-path dependency: this is admin-only tooling. It must not be called from any non-admin route or
  screen.

## Explicitly out of scope for this PR

- SleepNet-stages and step_counter adapters (illustrative in the strategy doc, not required by D6's actual
  gate — add them only if/when something downstream actually needs to validate against them).
- D5 (own daytime-HRV) itself — that's the next phase after this one, and needs this harness to exist first,
  not the other way around.
- Tuning the ±5bpm tolerance band from real data — that happens after the owner's first spot-check run, not
  speculatively now.
