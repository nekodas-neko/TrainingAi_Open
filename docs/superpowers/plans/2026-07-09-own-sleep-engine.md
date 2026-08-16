# Plan — Our Own Sleep Engine (windows + heuristic stages + metrics)

**Date:** 2026-07-09 · **Branch:** `claude/sleep-cycles-hypnogram-ibqhxl`

## Goal

Replace the Oura "black box" for sleep: from the raw BLE signals we already capture, produce
the full sleep picture ourselves — accurate windows/times, a DEEP/LIGHT/REM/WAKE hypnogram, and
the stage-derived metrics (efficiency, onset latency, cycles, awakenings). Feeds the existing
ribbon (`sleep_phase_5_min`) and sleep_sessions columns.

## Why heuristic, not the ring's / a trained model

- The Ring 5 does not emit its own hypnogram over BLE (confirmed on-device: zero `0x4b/0x4e/0x5a`
  across full nights; `bedtime_period` is a 0.5h fragment).
- Oura's SleepNet weights ship encrypted (`.pt.enc`); the decryption key is server-only, not in
  the APK — unrunnable offline (open_oura's finding). Nothing to port.
- A supervised model of our own needs labeled ground truth, but our BLE raw signals and the old
  Oura Cloud stages never overlap in time (BLE starts at the 07-07 re-key; Cloud ends there), so
  we cannot build (raw → Oura-stage) training pairs. open_oura's own recommendation is to build
  from the decoded signals — which is this heuristic.
- **Honest limitation:** the stager is physiologically-motivated, not Oura-accurate, and cannot
  be ground-truthed against Oura. We validate on *proportions* (Deep/REM/Light %) and cycle shape
  against the owner's personal Cloud-era baselines, not a labeled truth.

## Signals (per 5-min epoch over the sleep window)

| Feature | Source tag | Decoded field | Role |
|---|---|---|---|
| movement | `0x72 sleep_acm_period` | `acm_mad` (mean) | actigraphy — sleep/wake |
| hr | `0x80/0x60` IBI | `hr_bpm` (mean) | depth (low = deep), wake spikes |
| hrv | `0x5d hrv_event` | `rmssd_ms` (mean) | autonomic — deep (high) vs REM (lower) |
| temp | `0x75/0x46/0x69` | `temps_c` (mean) | trough supports deep |

5-min epochs match the `sleep_phase_5_min` output granularity and the HRV cadence.

## Algorithm (`lib/health/sleep-staging.ts`, pure + tested)

`stageSleep(epochs: SleepEpoch[]): SleepStage[]` — per-night **self-normalizing** rules:
1. **WAKE** — movement above the night's high quantile (and > 2× median), or HR well above the
   night's resting floor, or an all-null epoch (not measuring).
2. **DEEP** — HR near the night floor (lowest third of floor→mean), HRV ≥ night mean, minimal
   movement (SWS = low stable HR + high parasympathetic HRV + stillness).
3. **REM** — HRV below night mean (more sympathetic) with atonia (very low movement), HR above
   deep — the classic REM cardiac signature.
4. **LIGHT** — everything else (the transitional default).
Then **smooth** (minimum bout length) so single-epoch flips don't fragment the hypnogram.

`summarizeSleepStages(stages)` → deep/light/rem/awake minutes, time asleep, time in bed,
efficiency %, onset latency, awakenings.

`stagesToPhase5Min(stages)` (in `hypnogram.ts`) → the `'1'=deep 2=light 3=REM 4=awake` string.

Thresholds are named constants, documented as provisional; the quantile basis makes them
scale-invariant (robust to the unknown `acm_mad` magnitude). Owner's baseline data (query A/B)
calibrates the few absolute constants and validates proportions.

## Rollup integration (`aggregateOuraRawSamples`)

Per sleep window: build 5-min epochs from the in-window raw rows, then:
- If ring phase events are present (`phases.length > 0`) → use them (future-proof).
- Else → `stageSleep(epochs)` (our model — the live path).
Populate the sleep row from whichever: `sleepPhase5Min`, deep/rem/light/awake hours,
`durationHours` (time asleep), `efficiency`, `onsetLatencySec`, `restlessPeriods`, `timeInBedHours`.

## Tests
- Unit (`sleep-staging`): synthetic nights with clear signatures → expected stage structure
  (high-movement block → wake; low-HR/high-HRV block → deep; low-HRV/still block → REM),
  smoothing, and summary math.
- DB (`aggregate`): raw movement/HR/HRV/temp for a night → sleep row with a populated
  `sleep_phase_5_min` + non-null stage hours + efficiency.

## Out of scope (separate, queued)
- The 0–100 sleep *score* stays with the Phase-5 own-scores plan (now has real inputs).
- Reading the ring's own hypnogram (backlog item 4) if a future firmware ever emits it.
