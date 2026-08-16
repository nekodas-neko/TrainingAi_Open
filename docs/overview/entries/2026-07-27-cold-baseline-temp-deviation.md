# Q-6 — a +17 °C body-temperature deviation was reaching the AI prompt

`updateBaseline` (`lib/health/personal-baseline.ts`) starts from `meanX8 ?? 0`. That is a faithful
port of ecore's `baseline_update_lt_mean_and_dev`, and correct for the ring, which carries its own
accrued state — but our fold **cold-started** on 2026-07-07, so the mean climbs from zero over
roughly three weeks and a deviation taken against it is nonsense.

Production `temp_dev_c`: **+17.000 °C** on 2026-07-09, then +8.500, +5.250, decaying to +0.038 by
2026-07-27. The HRV baseline read 23.5 ms against an actual 46.5 on the second night.

This was not cosmetic. The illness radar **is** gated (`illness-radar.ts:109`, and production shows
`illness_flag = 'learning'` through 07-19) and so is the readiness composite — but `temp_dev_c` is
**persisted**, and went verbatim into the AI health-insight prompt
(`app/api/ai/health-insight/route.ts:95` — *"Body temp deviation … +17.0°C"*) and onto the day-log
surface (`adapter.ts:1632`).

## Owner decision

Of the options offered — seed each baseline from its first sample, or keep the port and suppress the
derived values until mature — the owner chose **suppress**. The pinned port stays byte-for-byte as
ecore wrote it, which is what keeps this pipeline verifiable against the source.

## What shipped

`computeDailySummaries` withholds `tempDevC` until the row's own `nHistory` reaches
`BASELINE_MIN_NIGHTS` (14). Gated **at the point of derivation**, not at each consumer: the radar and
the composite already gate on the same constant, but `temp_dev_c` is persisted, so any future reader
would inherit the cold value unless it is never written. There is now nothing to miss.

The constant is imported from `readiness-composite.ts` rather than redeclared — same threshold as the
radar, so a row reading `n_history = 14` is mature in both places.

Both consumers already had null fallbacks, so the cold window now reads *"Body temp deviation: no
data"* or falls through to the explicitly-labelled pre-re-key Cloud value.

Migration 155 clears the rows already stored: **11 of 22** carried a deviation below 14 nights (worst
17.000 °C); the 9 mature rows are untouched. The baseline *state* columns are deliberately left
alone — the fold resumes from them, and changing them would break the property that seeding from a
checkpoint reproduces a full replay.

## Verification

Full suite **2,452 passing**, typecheck, lint and both custom-rule checks clean. New tests: two on the
fold (suppressed while cold across 13 nights, reported once mature, with the baseline still folding
throughout) and five DB-backed on the migration — including that exactly 14 nights counts as mature,
matching the radar's gate, and that the baseline checkpoint columns survive.

One existing DB-backed assertion had to change: `oura-ble-daily-summary.test.ts` asserted that night 2
*reports* a deviation. That was pinning the bug — night 2's baseline sits at roughly half the real
temperature, which is exactly what produced the +17 °C reading.

**Not exercised — on-device.** Postgres-side only; the local-store mirror of `temp_dev_c` picks up
whatever the pull delta carries.
