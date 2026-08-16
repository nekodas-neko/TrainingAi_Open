# Oura BLE — `oura_raw_samples` Disk-Footprint Reduction

**Source:** owner noticed the Railway Postgres volume (500 MB, personal single-user plan) at
77% capacity after only ~2 days of the BLE integration running. Diagnostic SQL against
`prod_DB` confirmed `oura_raw_samples` is the whole story (~90% of on-disk data). At the
measured growth rate (~25–30 MB/day), remaining runway was ~5 days, not enough to safely design
and ship a full retention system — the owner upgraded the Railway volume to 1 GB (2026-07-09) to
remove that time pressure before this plan's Finding 3 was finalized. A follow-up per-tag audit
(row counts, `body_hex` vs `decoded` byte split, index sizes) replaced the original one-line
guess in this plan with real numbers. **This revision supersedes the initial draft, which
incorrectly claimed `debug_event`/`debug_data` have no decoder — they do, and carry real data
(see below). Nothing in this revision drops those two tags.**

**Branch:** `feat/oura-ble-raw-samples-footprint`

**Server-only** — no APK rebuild. Three independent, separately-shippable fixes below; do (1)
and (2) regardless, decide (3) once you've read the tradeoff.

---

## Where the bytes actually go (prod snapshot, 2026-07-09, ~2.5 days of data, ~90k rows)

| Tag | rows | `body_hex` | `decoded` | Consumed by product code today? |
|---|---|---|---|---|
| `ibi_and_amplitude_event` (0x60) | 11,876 | 336 kB | 3,294 kB | **Yes** — `aggregateOuraRawSamples` → HR/HRV |
| `spo2_r_pi_event` (0x8b) | 14,545 | 383 kB | 2,046 kB | **Yes** — SpO₂ derivation |
| `green_ibi_quality_event` (0x80) | 7,163 | 199 kB | 2,016 kB | **Yes** — HR/HRV |
| `debug_data` (0x61) | 14,826 | 343 kB | 1,128 kB | **Yes, but not wired up** — decodes to ASCII/battery/charging events; matches the queued "Part A — battery time-series" backlog item, just nobody reads it into a table yet |
| `motion_event` (0x47) | 4,136 | 46 kB | 669 kB | **No** — see below |
| `debug_event` (0x43) | 7,275 | 169 kB | 209 kB | Ambiguous — ASCII connection/debug log text, no current reader |
| `sleep_acm_period` (0x72) | 2,135 | 52 kB | 206 kB | **Yes** — the actual movement input to `lib/health/sleep-staging.ts` |
| `temp_event` (0x69/0x46/0x75) | 3,143 | 40 kB | 207 kB | **Yes** — temp/HRV rollup |
| `motion_period` (0x6b) | 128 | 3.4 kB | 81 kB | **No** — see below |
| everything else (17 tags) | ~4,000 combined | ~50 kB combined | ~250 kB combined | Mixed, all small |

**Indexes** (independent of any row's content): `oura_raw_samples_pkey` 3.1 MB,
`…user_id_ring_timestamp_ds_tag_body_hex_key` (the dedup unique constraint) 9.7 MB,
`…user_tag_ts` 6.3 MB, `idx_…user_measured` 11 MB. **~30 MB total — more than half the table's
58 MB.**

## Finding 1 — `motion_event`/`motion_period` are dead weight, safe to stop expanding

`decodeMotion`/`decodeMotionPeriod` (`lib/oura-ble/decode.ts:234`, `:302`) turn a handful of
raw bytes into per-sample arrays (avg x/y/z, or 4-level motion bitfields) — a 14–24× hex→JSON
expansion, the worst ratio of any tag. But the actual movement input used by the app's own
sleep-staging engine is explicitly `0x72` `sleep_acm_period`'s `acm_mad` — a compact 6-number
summary per period (`lib/health/sleep-staging.ts:13`, `:271`). The ring already emits a
summarized movement signal that's the one the product consumes; `motion_event`/`motion_period`'s
raw per-sample detail has no reader anywhere in the codebase and isn't named as a target by any
queued or unqueued backlog item (checked against the extended-metrics spec — it lists `0x47` as
"already captured," not as a planned new use). **Recommendation: stop storing `decoded` for
these two tags (keep `body_hex`, satisfying the archival invariant literally — if a future need
ever emerges, Redecode regenerates it from the hex).** This alone removes ~750 kB today and,
being the worst-ratio tag, an increasing share of growth over time.

## Finding 2 — `debug_data`/`debug_event`: keep, and consider actually wiring one up

Correcting the original draft: both have real decoders. `debug_data` produces structured
`battery_level_changed` (percent + voltage) and `charging_time` events, or printable ASCII —
this is exactly the raw material for the already-written "Part A — battery time-series → avg
charging time / drain rate" backlog item, just not yet piped into a table. `debug_event` is
ASCII debug/connection log text with no current reader, but it's small (378 kB total) and low
per-row cost — not worth a special case. **Recommendation: keep both as-is.** No change. (If a
future session wants to build the battery-history feature, this is exactly the data to build it
on — flag that as a nice side-benefit, not new scope for this plan.)

## Finding 3 — resolved: tiered downsampling for the biometric tags, decided 2026-07-09

`ibi_and_amplitude_event`, `spo2_r_pi_event`, `green_ibi_quality_event` are consumed directly by
`aggregateOuraRawSamples` to compute daily/nightly `sleep_sessions`/`body_metrics`/
`oura_heartrate` rows — this is real, current product data, not speculative. But once a night's
worth of these has been rolled up into those derived tables, the ongoing value of keeping every
individual raw IBI/SpO₂ sample **at full JSON-decoded resolution forever** is specifically to
support *re-running* the rollup later — which only matters while the rollup formulas are still
being actively tuned (both `docs/oura-ble-sleep-staging-findings.md`'s calibration work and the
open SpO₂ offset-calibration backlog item are exactly this: re-deriving from raw to fix a
formula). That's a real, current need — but not an indefinite one.

**Important clarifying point that shaped this decision:** none of this touches the data the app
actually displays. `oura_heartrate` (5-min binned HR), `sleep_sessions` (nightly), and
`body_metrics` (daily HRV/RHR/SpO₂/temp) are already tiny, permanent, forever-kept product
tables, computed once by the rollup and never touched by anything below. This section is only
about the *pre-binning raw material* in `oura_raw_samples` that fed that computation — losing it
means losing the ability to redecode/recompute a past period, not losing anything currently on
screen.

**Decision (owner, 2026-07-09): tiered downsampling, not a single cutoff.** Modeled on
RRDtool/Prometheus-style resolution decay, with one important adjustment from the first draft of
this idea — data-loss severity, not just bin width, has to decay in step:

| Age | Treatment | Data-loss level |
|---|---|---|
| 0–3 days | No change — full `body_hex` + `decoded`, every event | None |
| 3–14 days | **Representative-sample thinning**: keep one real event per ~5-min bin per tag (full `body_hex` + `decoded` for the survivor), discard the rest of the bin's rows entirely | Sub-bin resolution lost; real ring bytes still spot-checkable for every ~5-min window |
| 14–90 days | Same representative-sampling mechanism, wider bins (~15–30 min) | Coarser spot-check granularity; still real bytes, still redecodable |
| 90+ days | **Hard delete** — no raw rows survive for these tags; the permanent record is whatever `oura_heartrate`/`sleep_sessions`/`body_metrics` already computed | This is where "archival forever" is deliberately retired for aged data — irreversible past this point |

**Why the hard-delete boundary is 90 days, not 2 weeks:** representative sampling (keep-one,
discard-rest) is low-risk and reversible in spirit — you're trading resolution for space, but a
real example survives from every window, so a decoder fix can still be spot-checked against that
period. **Full deletion is not reversible** — it permanently forecloses reprocessing that period
under a fixed formula. Given this pipeline has already needed two retroactive redecodes for bugs
found after the fact (the NUL-byte decode bug, the measured_at-collapse bug) and currently has
two *open* calibration efforts (SpO₂ offset, sleep-stager tuning) that explicitly want to
reprocess recent raw history, deleting raw bytes on a 2-week horizon would risk deleting exactly
the data those in-flight efforts need. 90 days comfortably outlives any single calibration pass
while still bounding growth.

**Tag-level scope — apply the cascading tiers only where they earn their complexity:**
- `ibi_and_amplitude_event`, `green_ibi_quality_event` (the HR-feeding tags) get the full
  3-tier cascade above — HR is a continuous signal where finer recent resolution has real value
  (e.g. spot-checking a workout spike).
- `spo2_r_pi_event`, `hrv_event`, `temp_event` are inherently window-computed already (nightly
  SpO₂ %, nightly RMSSD) — a 5-min bin for these buys negligible extra insight over the existing
  daily rollup. Give these a single representative-sampling tier (skip the 3–14-day fine bin,
  go straight to ~30-min representative sampling from day 3), then the same 90-day hard delete.
- Everything else (Findings 1/2/4, all the small tags) is unaffected by this section.

**Not built in this PR** — this is a real feature (a consolidation job per tier boundary,
triggered opportunistically off ingest since there's no cron layer, per `docs/module-map.md`
§0) and shouldn't be rushed. Now that the Railway volume is upgraded to 1 GB (2026-07-09), there
is no time pressure forcing this to ship alongside Findings 1/2/4 — split it into its own
follow-up plan/backlog entry once Findings 1/2/4 have landed, sized as its own implementation
task (migration for a `body_hex_hash`-style representative-sample marker or a separate thinned
copy, the per-tier consolidation logic, and tests for the boundary transitions).

## Finding 4 — index bloat is the single biggest lever, and it's free

Indexes are ~30 MB of the ~58 MB total, and one of them
(`oura_raw_samples_user_id_ring_timestamp_ds_tag_body_hex_key`, 9.7 MB) exists purely to make the
ingest route's `ON CONFLICT DO NOTHING` dedup work — it embeds the **full raw `body_hex` text**
as part of a btree key, which is both unnecessary (dedup just needs equality, not ordering) and
expensive (variable-length text in a composite btree key has more per-entry overhead than
fixed-width columns). **Recommendation: replace it with a generated hash column.**

```sql
ALTER TABLE oura_raw_samples ADD COLUMN body_hex_hash bytea
  GENERATED ALWAYS AS (digest(body_hex, 'sha256')) STORED;
```
then replace the unique constraint to target `(user_id, ring_timestamp_ds, tag, body_hex_hash)`
instead of `body_hex` directly, and update the adapter's `.onConflictDoNothing()` target
accordingly. Needs the `pgcrypto` extension for `digest()` (`CREATE EXTENSION IF NOT EXISTS
pgcrypto;`) — verify Railway's Postgres allows it (it's a standard contrib extension, should be
available). This is a pure storage optimization: behavior, dedup semantics, and the archival
guarantee are all unchanged.

Separately, run a one-time `VACUUM (VERBOSE, ANALYZE) oura_raw_samples;` regardless of any other
change here — `idx_oura_raw_samples_user_measured` (11 MB, the single largest index) is a
plausible bloat candidate given the code's own comments about `measured_at` being re-stamped
repeatedly during anchor-drift correction and Redecode passes (each rewrite of an indexed column
leaves a dead index entry until vacuumed). This is zero-risk and worth doing immediately,
independent of the rest of this plan — no PR needed, just run it in the Railway console.

## What this plan does NOT do

This PR implements only Findings 1, 2 (no-op/keep), and 4. Finding 3's tiered-downsampling
design is **decided** (see above) but **not implemented here** — it's sized as its own follow-up
plan/backlog entry, to be built once there's no time pressure. The Railway volume was upgraded
to 1 GB on 2026-07-09 specifically to remove that pressure, so this doesn't need to be rushed
alongside the other findings.

## Verify

1. Local dev DB: apply the `body_hex_hash` migration, confirm existing rows backfill the
   generated column without error, confirm `ON CONFLICT DO NOTHING` still dedups correctly (POST
   the same frame twice, confirm only one row lands).
2. Confirm `motion_event`/`motion_period` rows still insert (with `decoded: null`) and don't
   throw when `aggregateOuraRawSamples`/`redecodeOuraRawSamples` run over a batch containing
   them (neither reads those tags today, but confirm nothing assumes `decoded` is present).
3. Run the VACUUM in prod, re-check `pg_relation_size` on `idx_oura_raw_samples_user_measured`
   before/after to confirm it actually reclaims space (if it doesn't shrink, the 11 MB is live
   data, not bloat, and that's useful to know too — not a promise, a thing to check).
4. `pnpm lint && pnpm exec tsc --noEmit && pnpm test` — no regressions.
