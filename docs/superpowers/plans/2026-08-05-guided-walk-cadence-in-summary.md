# Plan: surface cadence (SPM) alongside pace on the guided-walk summary

**Status:** planned, not implemented. **Branch:** `fix/guided-walk-cadence-in-summary`.

## Problem

The "Walk complete" summary screen (`components/guided-walk/walk-summary.tsx`) shows FAST/SLOW
average cards and a per-interval breakdown table with pace (min/km), avg HR and distance — no
cadence (steps per minute). For interval walking where the whole point is alternating effort
(fast block vs slow block), the owner's read is that cadence is the more useful "how hard am I
actually working" number than pace, especially since GPS pace on a short block is noisy (distance
over ~1-3 min is a small, error-prone sample) while step rate is direct and immediate.

## What already exists (this is a smaller gap than it looks)

Cadence is **not a new capability** — it's fully wired end-to-end and just gets dropped one step
before the summary screen:

- **Live walk screen already shows it.** `components/guided-walk/walk-active.tsx:94-96` starts a
  `CadenceTracker` and renders a live `<CadenceReadout tracker={cadenceTracker} />` at line 187.
  (So cadence is *not* missing on the live screen, contrary to how the report reads at first
  glance — it's missing on the **summary** screen and the **per-interval table**, which is a
  different component reading a different, already-aggregated data shape.)
- **Per-segment cadence is already computed.** `computeWalkSegmentStats()`
  (`lib/walk/segment-stats.ts:38-82`) slices the cadence series into each interval's exact time
  window (`samplesInWindow`, line 64-66) and produces `avgCadenceSpm` per segment (line 79) — sitting
  right next to `avgPaceSecPerKm` and `distanceKm` in the `WalkSegmentStat` type (lines 6-20).
- **It gets dropped at the kind-level rollup.** `aggregateSegmentsByKind()` (same file,
  lines 103-118) builds `KindAggregate` (fast/slow averages for the two summary cards) from
  `avgHr`/`avgPaceSecPerKm`/distance only — `avgCadenceSpm` is read from each segment but never
  folded in. `KindAggregate`'s own type definition (lines 84-94) has no cadence field.
- **Rendering also drops it**, independently of the aggregation gap:
  - `KindAggCard` in `walk-summary.tsx:283-300` (the two "Fast avg" / "Slow avg" cards) renders
    pace + HR only.
  - `KindColumn` in `components/guided-walk/walk-segment-stats-card.tsx:7-21` (a second place the
    same fast/slow aggregate renders) also renders pace + distance + HR only.
  - The per-interval loop at `walk-summary.tsx:245-257` reads `s.avgPaceSecPerKm`/`s.avgHr` off
    each `WalkSegmentStat` and ignores the `s.avgCadenceSpm` that's already sitting on the same
    object.
- **Persisted, not ephemeral.** `activity_logs.cadence_spm` / `cadence_spm_series` /
  `cadence_source` columns exist (migration `140_activity_cadence.sql`), so this isn't a "we'd
  have to start capturing it" problem.

## The real constraint: data source, not plumbing

Cadence only has a value when a wearable that can produce it is connected during the walk:

- **Polar H10 chest strap** — validated, accelerometer-derived, ~1 reading/sec
  (`packages/shared/src/health/cadence.ts`, `detectCadence`), confirmed accurate 64-150 spm in
  production (`docs/implementation-backlog.md` Q-47, closed 2026-08-04). This is the reliable
  source today.
- **Oura ring** — `cadenceFromStrideHz` exists but is **gated off**:
  `RING_CADENCE_VALIDATED = false` (`cadence.ts:218`) because the stride-frequency signal is
  octave-ambiguous (half/double-counting risk) and unresolved. Even if it were validated, ring
  readings are far sparser (~1 per 30-min walk per
  `docs/overview/entries/2026-08-02-empty-cadence-series.md`) — enough for a single walk-level
  number, not a real fast/slow split.
- **GPS-only walk, no strap/ring connected** — no cadence source at all today. There is no phone
  accelerometer step-counter wired into activity logging (Health Connect steps are a daily/coarse
  rollup, not a live per-second series suitable for interval attribution). This case must render
  as `—`, same as pace already does with no GPS fix.

So the fix does not need a new native plugin or a new APK for the surfacing gap itself — it's
UI/aggregation-only, gated by whether a supported wearable happened to be connected for that walk.

## Fix approach

1. **`lib/walk/segment-stats.ts`**: add `avgCadenceSpm: number | null` to `KindAggregate`
   (line ~84-94) and compute it in `aggregateSegmentsByKind()` (line ~103-118) the same way
   `avgHr`/`avgPaceSecPerKm` are computed — `avg()` over the non-null cadence values of segments
   of that kind.
2. **`components/guided-walk/walk-summary.tsx`**:
   - `KindAggCard` (line 283-300): render `agg.avgCadenceSpm` next to pace, e.g. "112 spm" as a
     secondary line — decide with a quick look at the existing card's visual hierarchy which
     number leads (the owner's framing suggests cadence may deserve equal or higher billing than
     pace for interval walks specifically, not just an added footnote).
   - Per-interval loop (line ~245-257): add `s.avgCadenceSpm` to the row alongside pace/HR.
3. **`components/guided-walk/walk-segment-stats-card.tsx`**: same addition to `KindColumn`
   (line 7-21), since it renders the identical aggregate shape at a different call site — sibling-
   surface sweep, not optional (CLAUDE.md's "Sibling-surface sweep" rule).
4. **No-cadence case**: render `—` exactly like the existing pace null-handling, not a hidden row —
   consistency with how a GPS-less walk already handles missing pace.
5. Decide (as an implementation-time UI call, not here) whether cadence should also get a place on
   the live `walk-active.tsx` interval-in-progress display beyond the existing `CadenceReadout` —
   out of scope for this plan; that screen already has a live cadence readout, just not broken out
   per completed interval yet.

## Verification

- `pnpm dev`, run (or fake) a guided walk with a connected Polar H10, confirm cadence appears on
  both summary cards and every per-interval row.
- Run one with no strap connected, confirm graceful `—` rendering, no crash, no layout shift.
- No DB/migration change (columns already exist), no sync/outbox implications — this is a
  read/render-time aggregation of data already being computed and persisted.

## Task breakdown for the implementer session

1. Re-verify against current `main` — this is a young feature (2026-08-02) and the cadence
   validation status (`RING_CADENCE_VALIDATED`) or segment-stats shape could have moved.
2. Add `avgCadenceSpm` to `KindAggregate` + `aggregateSegmentsByKind()`.
3. Render it in `KindAggCard`, `KindColumn`, and the per-interval row (three call sites, sibling
   sweep).
4. Manually verify in `pnpm dev` with and without a connected cadence source.
5. Journal entry + `projectOverview.md` update in the same PR.
