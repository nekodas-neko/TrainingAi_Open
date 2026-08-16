# Oura BLE Phase 5 — Own Readiness / Sleep / Activity Scores (home-screen health pills)

**Source review:** `docs/oura-ble-remaining-work.md` item 5, `docs/implementation-backlog.md`'s
former "Not yet queued" Phase-5 bullet, `.agents/skills/oura-native-ble/SKILL.md` §9–11 (formula
inventory + why we don't touch Oura's encrypted models), and a fresh audit of the home screen
(2026-07-08) triggered by the user noticing the four score chips are gone since the BLE re-key.

**Branch:** `feat/oura-ble-own-scores`

**Server/JS only** — no APK rebuild for any chunk below; ships via Railway.

**Goal:** The home screen's four score chips (`components/oura-score-chip-row.tsx` →
`OuraScoreChipRow`, wired at `app/session-select/session-select-content.tsx:1033`) were never
deleted — they're empty because the fields they read (`oura_daily.readinessScore` /
`sleepScore` / `activityScore`) are Cloud-only and stopped updating at the 2026-07-07 BLE
re-key, and because the whole row is gated behind an all-or-nothing `hasSufficientData` flag.
The Heart Rate chip already works off BLE data (`getHrForWindow`) and needs nothing. This plan
computes our own 0–100 Sleep, Readiness, and Activity scores from data the BLE rollup already
writes (HRV, resting HR, sleep duration/efficiency, wear time —
`lib/data/postgres/adapter.ts:aggregateOuraRawSamples`) plus training-load math the app already
has (`computeVolumeAcwr`), and makes each chip light up independently as its own inputs become
available instead of waiting on all four. Per the skill's explicit design principle (§9–11):
these are **our own formulas, not a clone of Oura's proprietary/encrypted scoring models** —
expect them to diverge from historical Oura numbers, and say so in the UI.

**Sequencing note:** Chunk 1 (sleep) and Chunk 2 (readiness wiring fix) need no new data and can
ship immediately. Chunk 3 (activity) is meaningfully better once the ring-steps feature-enable
(`docs/oura-ble-remaining-work.md` item 2) lands, but doesn't need to wait — it can run on
Health-Connect `body_metrics.steps`/`activeCalories` plus logged training volume from day one.

---

## Chunk 1 — Custom sleep score (data already fully lands over BLE)

`sleep_sessions` rows already get `durationHours`, `efficiency`, `restlessPeriods`,
`respiratoryRate` from the BLE rollup today; `deepSleepHours`/`remSleepHours`/`lightSleepHours`/
`awakHours` are only non-null when hypnogram phase events (`0x4b/0x4e/0x5a`) are present for a
given night — treat as optional, not guaranteed, per `aggregateOuraRawSamples`'s existing
comment ("No hypnogram over BLE → no stage breakdown" for nights where they're absent).

1. New `lib/health/sleep-score.ts`: `computeSleepScore(session: SleepSessionRow): { score:
   number; components: Record<string, number> } | null`. Weighted composite over whichever of
   these are non-null, renormalized to 100 over only the available components (never fabricate
   a value for a missing one):
   - Duration vs a personal target (default 8h — same denominator the existing crude
     `sleepScore` heuristic in `app/api/readiness-score/route.ts:128` already uses) — largest
     weight.
   - Efficiency (`efficiency` 0–100, used directly).
   - Restfulness proxy from `restlessPeriods` (lower is better — start with a fixed heuristic
     band, tune later).
   - Timing consistency — reuse `lib/health/sleep-consistency.ts`'s existing output if it
     already produces a comparable 0–100 signal; otherwise skip this component rather than
     build a second implementation (One Formula, One Place).
   - Stage balance (deep/REM proportion) **only when stage hours are non-null** for that night.
   Return `null` only when duration itself is missing (nothing to score).
2. In `app/api/readiness-score/route.ts`, replace the crude inline `sleepScore` (line 128,
   currently `min(40, hours/8*40)` on a 0–40 scale used only inside the readiness composite)
   with a call into the new module, and expose a separate 0–100 `sleepScore` field for the chip
   that isn't Oura-gated (currently `sleepScore: ouraToday?.sleepScore ?? null` at line 228 —
   change to `ouraToday?.sleepScore ?? computeSleepScore(lastSleep)?.score ?? null`). Keep the
   readiness composite's internal 0–40 sleep component fed from the same underlying computation
   (scaled) rather than a second formula.
3. No new cache key needed — `readiness-score` already covers this response.

**Verify:** seed a `sleep_sessions` row via the local dev DB with only `durationHours`/
`efficiency` set (stage columns null, matching a real BLE night), hit `/api/readiness-score`,
confirm `sleepScore` is a non-null 0–100 number and `/health/sleep` renders without relying on
null stage fields.

## Chunk 2 — Readiness chip: fix the wiring, not the formula (mostly already built)

The route **already** computes a full custom composite readiness score whenever Oura's isn't
available (`app/api/readiness-score/route.ts:182-196` — `sleepScore + hrvScore + rhrScore +
loadScore`, returned as the top-level `score`/`label`). The bug is that `OuraScoreChipRow`'s
"Readiness" chip reads a *different* field, `ouraScore`, hardwired to `ouraToday?.readinessScore
?? null` (line 224), which never falls back to the composite sitting right next to it in the
same response.

1. Add a `readinessDisplayScore: number | null` field to `ReadinessScoreResponse`, computed as
   `ouraToday?.readinessScore ?? score` (the composite is already unconditionally computed, so
   this is a same-response alias, not new computation) — name it neutrally rather than
   `ouraScore` since it's no longer Oura-specific.
2. Update `OuraScoreChipRow`'s Readiness chip (`components/oura-score-chip-row.tsx:88`) to read
   `readiness.readinessDisplayScore` instead of `readiness.ouraScore`. Grep `ouraScore` for any
   other read site — the `/health/readiness` detail page is the obvious sibling — and update it
   in the same PR if it also branches on the Oura-only field (Sibling-Surface Sweep rule).
3. Feed the composite's internal `sleep` component (0–40) from Chunk 1's real sleep score
   (scaled to /40) instead of the existing crude duration-only heuristic, now that a better
   signal exists.

**Verify:** with a seeded account that has ≥5 days of BLE-derived HRV/RHR in `body_metrics`
(satisfying `baselineHrv != null` at line 132) but no `oura_daily` row, confirm
`readinessDisplayScore` is non-null and the Readiness chip renders a value + band.

## Chunk 3 — Activity score: build a real base (today's blend has none)

`blendActivityScore` (`lib/activity/blend-activity.ts`) only ever *adjusts* an Oura base score —
with `ouraActivityScore` permanently null post-re-key, `final` is always null regardless of
logged training (lines 40-41: `if (!trained || base == null) return { ..., final: base }`).
This chunk gives it a real base that doesn't depend on Oura Cloud.

1. New `lib/health/activity-score.ts`: `computeActivityScore(input): number | null` — a 0–100
   composite from data available without Oura Cloud today:
   - Movement: `body_metrics.steps` / `activeCalories` for the day (Health-Connect sourced,
     already flowing per `docs/oura-ble-remaining-work.md` item 2's "steps chart runs on
     phone/Health-Connect steps" note) vs. the user's own trailing personal average — relative,
     not an absolute step target.
   - Training credit: reuse the `TRAIN_CREDIT_BASE`/`TRAIN_CREDIT_VOL` shape from
     `blend-activity.ts` but anchored to *this* base instead of Oura's, so a lifting-only day
     (low steps, real training stimulus) doesn't score as "sedentary."
   - Leave a documented extension point for ring MET bins (`activity_information` 0x50) once
     `docs/oura-ble-remaining-work.md` item 2b's decoder work lands — do not block this chunk on
     it; MET data is explicitly "best-effort" per the skill.
2. In `app/api/readiness-score/route.ts`, change the `blendActivityScore` call (line 161) to
   pass `ouraActivityScore: ouraToday?.activityScore ?? computeActivityScore(...)` so
   `activityBlend.final` is non-null again once Oura's field is gone.
3. Reconsider whether `blendActivityScore`'s "adjustment/boost" framing (chip UI shows a "+N"
   badge for logged training, `components/oura-score-chip-row.tsx:47-54`) still makes sense once
   the base itself already incorporates training credit — avoid double-crediting logged volume.
   Likely resolution: fold training credit into the new base only, and stop calling
   `blendActivityScore` for non-Oura days (pass the new base straight through with
   `adjustment: 0`).

**Verify:** seed `body_metrics.steps`/`activeCalories` for a day plus a logged workout session
with tonnage, hit `/api/readiness-score`, confirm `activityScore` is non-null and doesn't
double-count the same session's credit.

**Shipped (v1.124.0, 2026-07-09):** `lib/health/activity-score.ts` (`computeActivityScore`,
unit-tested — movement relative to trailing personal average + training credit, renormalised
over whichever inputs are present). `readiness-score` route now passes Oura's blend through
unchanged when an Oura activity row exists, else passes the new own-base straight through with
`adjustment: 0` (resolution 3's "fold training credit into the base only" — no double-counting).
Verified end-to-end on the local dev DB: a low-step day (2,000 vs an ~8,300 trailing average)
scored 23; `/health/activity` and `/health/readiness` render 200.

## Chunk 4 — Chip row: light up independently, not all-or-nothing

`OuraScoreChipRow` itself already self-hides only when **all four** fields are null (component
lines 76–84) — that part is correct. The bug is one level up: `session-select-content.tsx:1033`
renders the row only when the entire `readiness` state is set, and `readiness` state is only
ever set when the API's `hasSufficientData` is `true` (route lines 200-201: requires either a
permanently-null Oura row, or a sleep session **and** an HRV/RHR baseline together — i.e. every
metric, not just one).

1. Stop gating the fetch-into-state step on `hasSufficientData`
   (`session-select-content.tsx` ~lines 317-320 cache seed, ~623-633 live fetch) — always set
   `readiness` from a successful response; let the chip row's existing per-field null-check do
   the hiding.
2. Repurpose `hasSufficientData` for whatever it's still needed elsewhere (check other read
   sites — likely still used by `EarlyDeloadCard`/early-deload gating — before removing the
   field outright) rather than deleting it; just stop using it to gate the whole pill row.

**Verify:** on an account with only 1–2 days of BLE data (sleep score available from Chunk 1,
but HRV baseline <5 days so Chunk 2's composite is null), confirm Sleep + Heart Rate chips show
real values while Readiness + Activity chips show "—" — not the whole row disappearing.

## Chunk 5 — Label these as our own scores (user's explicit ask, skill §9)

1. Add a short line to the `/health/readiness`, `/health/sleep`, `/health/activity` detail pages
   (and/or a chip tooltip) noting these are computed by the app from ring + training data, not
   Oura's proprietary scoring — matches the skill's stated design principle and avoids confusing
   anyone comparing against old Cloud-era numbers.
2. No formula name or UI copy should claim parity with Oura's discontinued scores.

**Verify:** manual read-through of the three detail pages + chip tooltips.

---

## Addendum (2026-07-09): open_health-recovered formula + baselines substrate

A full read of `Th0rgal/open_health` (the open_oura author's own consumer app) surfaced the
**actual recovered Oura combiner weights + validated contributor curves** — a strict upgrade to
Chunk 1's "start with a fixed heuristic band, tune later," and the substrate that turns Chunk
2's Readiness from crude to baseline-relative. These are *our own* computations (we never touch
Oura's encrypted models), but they let us reproduce Oura-comparable numbers instead of guessing
weights. Sources: `open_health/docs/algorithms/score-weights.md`,
`docs/algorithms/daily-summaries-and-baselines.md`, and `open_oura@split-open-health`'s
`crates/oura-analysis/src/ported/{temperature,baseline,sleep_debt}.rs` (ported + tested).

### A1 — Use the recovered Sleep Score weights in Chunk 1

open_health recovered the ecore Sleep Score combiner by regressing Oura's own Trends export
(336 days) at **R²=0.9987** — essentially exact. Replace Chunk 1's ad-hoc weighting with:

| weight | contributor | our source (already in `sleep_sessions` / rollup) |
|--:|---|---|
| 35% | Total Sleep | `durationHours` vs personal target |
| 15% | Restfulness | `restlessPeriods` + awake fraction + `efficiency` |
| 10% | Sleep Efficiency | `efficiency` |
| 10% | REM Sleep | `remSleepHours` (when non-null) |
| 10% | Deep Sleep | `deepSleepHours` (when non-null) |
| 10% | Sleep Latency | onset latency (U-curve: very short **and** very long both penalised) |
| 10% | Sleep Timing | circadian curve peaked at ~03:00 midpoint + 7-day regularity |

Combiner is `round(Σ wᵢ·subᵢ / 100)`, renormalised over whichever contributors are non-null
(never fabricate a missing stage). Two nuances open_health validated and we should copy:
**Sleep Latency is a non-monotone U-curve** (not "shorter = better"), and **Sleep Timing is
circadian** — a peak at a ~03:00 sleep midpoint plus day-to-day regularity, not just duration.
The contributor→sub-score curves (`fit_sleep_score.py`) reconstruct 5 of 7 essentially exactly;
we can start with those shapes (isotonic/empirical) rather than inventing bands. Put the weight
table + curves once in `lib/health/sleep-score.ts` (One Formula, One Place).

### A2 — Recovery Index (new; single-night, zero history needed)

open_health's `daily-summaries-and-baselines.md` documents a from-scratch **Recovery Index**:
from the overnight IBI→HR series (rolling-median smoothed), find when resting HR bottoms out and
report **hours between that minimum and wake** (earlier settle = more recovered). No baseline
needed — computable from a single night's `oura_raw_samples` IBI we already store. Add
`lib/health/recovery-index.ts` and feed it as a Readiness contributor. (Mapping raw hours →
0-100 sub-score isn't calibratable from the export, so surface the raw hours with a constant
sub-score fallback, flagged — same honesty as open_health.)

**Partially shipped (v1.124.0, 2026-07-09):** `lib/health/recovery-index.ts`
(`computeRecoveryIndex` — rolling-median-smoothed HR minimum, hours-to-wake, unit-tested) shipped
as the standalone pure function. **Not yet wired into the readiness route/response** — feeding it
in as an actual Readiness contributor needs a sub-score mapping decision and is better done
alongside A4's reweight (below), so it's left for that follow-on rather than bolted onto the
composite ad-hoc here.

### A3 — Daily-summary + rolling baselines table (the Readiness substrate — **one migration**)

Chunk 2's Readiness composite is currently crude because the baseline-relative contributors
(HRV Balance, Resting-HR, Sleep/Activity Balance, Temperature) compare *today vs a personal
~14-day baseline* — state we don't carry. open_health's fix is a per-night `daily_summary` row +
five trailing-14-day baselines (`hrv/rhr/temp/sleep/met_baseline`, causal/trailing-only), accrued
nightly. This is the **one schema change** the open_health review motivates:

- **New migration 116** (`116_oura_daily_summary_baselines.sql`): a `oura_daily_summary` table,
  one row per bedtime night — sleep metrics + `hrv_avg`, `rhr_low/avg`, `recovery_index_h`,
  `temp_mean`/`temp_dev`, `met_avg`, and the five trailing-14-day baselines + `n_history`.
  Re-runnable; baselines trailing-only. Register the table in the local-store reconcile lists if
  it needs to be offline-readable (likely server-only aggregate — leave on `cachedFetch`, matching
  the other cross-session aggregates per CLAUDE.md).
- Populate it from `aggregateOuraRawSamples` (the rollup already runs post-drain and has all
  inputs). Baselines are **cold < 14 days** → the scorer flags each cold contributor as
  provisional and falls back to neutral, exactly as open_health does — no fake precision.
- **Nightly temperature deviation** (`temp_dev`): port open_oura's tested
  `ported/temperature.rs` + `ported/baseline.rs` — 7-sample median → 30-min window, asymmetric-EMA
  baseline. Our own skill flagged this as "we store temps but compute nothing"; this closes it and
  feeds both Readiness (Temperature contributor) and illness/anomaly signals.

### A4 — Readiness weights (recovered, for Chunk 2's composite)

open_health recovered Readiness at R²=0.969 (linear + a rest-mode nonlinearity): RHR ~17%,
Previous Night ~15%, HRV Balance ~15%, Temperature ~13%, Sleep Balance ~12%, Prev-Day Activity
~10%, Recovery Index ~10%, Activity Balance ~7%. Use these to weight Chunk 2's composite once A2
(Recovery Index) and A3 (baselines) exist. Note the honest ceiling: the baseline-relative half
(~50% of weight) only becomes accurate after ~14 nights of accrued history — before that,
Readiness stays provisional (flagged), same wall open_health hits.

### Sequencing of the addendum

A1 (sleep weights) ships with Chunk 1 — no new data. A2 (Recovery Index) is a standalone pure
function, ship anytime. A3 (migration + baselines) is the one schema change and unblocks A4
(baseline-relative Readiness) — do A3 before A4. None of this needs an APK rebuild; all
server/JS + one Postgres migration.

