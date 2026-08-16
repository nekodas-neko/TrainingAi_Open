# Oura Data-Requirements Map — the Keep / Cull / Calculate / Backup Matrix

**Date:** 2026-07-21 · **Type:** data-requirements audit + architecture decision record (docs-only, in-sandbox).
**Ships:** no code, **no migration, no data dropped.** Anything that would drop `body_hex` or a biometric tag
is called out for **owner confirmation**, never done here.
**Branch:** `claude/oura-ondevice-data-audit-xvmhqk`.

> **This is "the first part of the puzzle"** named in `docs/oura-on-device-handover.md`: the definitive
> answer to *what data do we actually need to keep vs. calculate*, unifying the two threads the owner
> wants worked as one — (1) move raw + calculation on-device, (2) figure out what to keep/calculate/
> discard/back-up. Every downstream piece — the tier ladder (Phase-0 §2), the Phase-1 rollup port, the
> Phase-2 backup subset — builds on this map. It is **grounded in real code**, not the plan prose: five
> parallel source audits of `aggregateOuraRawSamples`, `decode.ts`, `lib/oura-models/`, `schema.ts` vs
> `lib/sqlite/migrations.ts`, and every read surface. Where those audits **contradicted the prior docs,
> the code wins** — see §10.

> **Read first:** `CLAUDE.md` (DB / sync / offline / SQLite / BLE + "Oura Direct-BLE"),
> `docs/oura-on-device-handover.md`, `docs/superpowers/plans/2026-07-21-oura-raw-on-device-architecture.md`
> (Phase-0 spec + Review Outcome), `2026-07-21-oura-decoupling-and-own-models-strategy.md` (own-analysis
> strategy — currently in unmerged **PR #731**), `2026-07-15-oura-data-architecture-and-culling.md`,
> `docs/db-volume-cleanup-handover.md`, `docs/oura-ble-operations.md`.

---

## 0. The answer, in one screen

The owner asked four questions. Here they are, answered; the rest of the doc is the evidence.

**Q1 — What raw do we keep, and for how long?**
Keep **`body_hex` for every biometric tag the rollup consumes or a kept model needs** — storage-aware on
the phone (prune oldest only under real storage pressure), effectively indefinite because reprocessing
history with a better decoder/model is the whole point of "future-proof." That is **~all of the biometric
tag set** — because we own nearly every metric *and* the two kept models (SleepNet, step_counter) between
them consume the full biometric spectrum. Raw leaves **Railway entirely** (the 437k-row drop) and lives
single-copy on device. The only raw with a *bounded* window is the small set that feeds **only a dropped
metric** (raw PPG → vascular-age, atlas bioZ → body-comp) or is **decoded-but-unused** (`ehr_trace 0x73`)
— bounded by `max(decoders-stabilised, ~2–3-month oracle-deprecation)`, then cull-eligible **on owner
confirmation**. (Daytime motion `0x47` is **not** in this set — it is a soft input to the kept
`step_counter` model, so it is keep-raw; see §3a.)

**Q2 — What do we calculate/persist, and at what tier?**
We calculate **every displayed metric ourselves** (decode → `lib/health/*` math → finished form). The
**displayed value always reads from a finished daily/nightly form**, never the raw ladder: `sleep_sessions`
(per night), `body_metrics` (per day scalars), `oura_daily` / `_summary` / `_derived` (per day
scores/physiology/derived). The **`oura_bucket` tier ladder** (10s→24h) is *supplementary trend
resolution* for the continuously-binned series (HR mean/min/max, SpO₂, MET, skin-temp, motion) — fine
tiers device-only, coarse tiers (≥30 min) backed up. Two ML models stay in the compute path — **SleepNet**
(hypnogram + BDI, live now) and **step_counter** (steps, *not yet wired* — TODO). Everything else the code
calls a "model" (chronic stress, resilience, illness, energy, step-estimate) is **deterministic ported
math**, not neural.

**Q3 — What do we discard?**
On device: the `decoded` JSONB (already not persisted — culling Lever 1); fine tier-ladder resolution once
promoted past its horizon (irreversible promotion). On server: the **entire raw table** (Phase 3, confirm-
first), the already-nulled `decoded` column, and telemetry/debug tags (already dropped at ingest —
`RAW_STORAGE_DROP_TAGS`). Raw `body_hex` for kept metrics is **never** discarded except under device storage
pressure.

**Q4 — What do we back up to Railway (the restore subset)?**
Only the **finished forms**, device-push-populated: `sleep_sessions` (full), `body_metrics` (Oura columns),
`oura_daily`, **`oura_daily_summary`** (the load-bearing physiology + EMA baselines that feed readiness/
illness), **`oura_daily_derived`** (resilience/illness/chronic-stress/BDI/training-load/body-comp),
`oura_heartrate` (5-min + 15-sec-workout series), and the **coarse `oura_bucket` tiers (≥30 min only)**.
**Never** raw `body_hex`, **never** the fine bucket tiers. **The gap that must close first:** of these,
only `ouraDaily` (reduced) and `sleepSessions` are sync-wired today — `oura_daily_summary`,
`oura_daily_derived`, `oura_heartrate`, `oura_bucket` have **no pull-delta domain at all** (§10 C1). The
restore subset is undeliverable until they get the full offline chain.

**The shape of the future (the discussion the owner asked for):** device-primary, Garmin/Apple-Health
style. The phone owns raw and does *all* compute including ML; Railway holds a compact backup that never
computes. Oura's cloud and proprietary models drop out of the interpretation entirely — SleepNet and
step_counter graduate from "temporary oracle" to "kept model," the other vendored models are an
**observe-never-feed** oracle deleted at ~T+3 months, and a **Polar H10 chest strap** serves as an
intermittent, non-circular **validation spot-check** (a test instrument worn for bursts — *not* a data
source, primary source of truth, or longitudinal record; the ring stays the source and our math carries
longevity) so we're not permanently anchored to Oura's own errors. The net result:
Railway's Oura footprint goes from raw-dominated + unbounded (~200 MB, +50 MB/week) to a bounded
finished-form backup (~tens of MB), and the app can reprocess its entire history from archived raw the day
we ship a better decoder or model.

---

## 1. The four-layer model (how to read every table below)

Every metric flows through four layers. The **strategy overlay** (own-vs-keep-vs-drop) attaches at the
Interpret layer; the **retention verdict** attaches at the Raw layer.

```
  RING BYTES ──decode──▶ QUANTITIES ──interpret──▶ FINISHED FORM ──read──▶ DISPLAYED METRIC
  (body_hex)   (Oura-      (IBI→HR,      (lib/health/*    (oura_daily_*,     (readiness card,
   per tag      faithful,   °C, MET,      math + 2 kept    sleep_sessions,    sleep screen,
   0x41–0x8b)   forever)    rMSSD)        ONNX models)     body_metrics)      AI, weekly digest)
```

| Layer | Code home | Rule (strategy §1) | This doc's axis |
|---|---|---|---|
| **Decode** | `lib/oura-ble/decode.ts` | Stay Oura-faithful forever — deterministic RE, golden-pinned | which tags carry what |
| **Interpret** | `lib/health/*`, `lib/oura-models/*` | Becomes **ours** — own every metric except SleepNet + step_counter | own / keep-model / drop / oracle |
| **Finished form** | Postgres `schema.ts` ⇄ local `migrations.ts` | Subsume, don't duplicate | tier + backup subset |
| **Displayed** | routes + `components/health/*` | Read finished form (local-first), not raw | consumer / unconsumed |

**Ground truth of what runs today** (`aggregateOuraRawSamples`, `adapter.ts:4033–5003`): exactly **two
ONNX models execute** — **SleepNet** (`sleepnet_moonstone_1_2_0_core.onnx`; staging @4383 + apnea/BDI head)
and **dHRV imputation** (`dhrv_imputation_1_1_0.onnx`; one pass per 30-min daytime bucket @4910, feeds
resilience). Everything else is deterministic math. The ONNX **step_counter, energy, illness, awhr, and
sleepnet-bdi models exist in-repo but are NOT invoked by the rollup** (step_counter reachable only from an
admin validation route; the rest dormant/test-only).

---

## 2. Metric inventory → provenance (the "what we calculate & at what tier" answer)

Every health/analysis output, its source tags, how it's computed today, where it lands, and who reads it.
`•` = the displayed/authoritative source. Line anchors in `lib/data/postgres/adapter.ts` unless noted.

| # | Metric | Source tag(s) | Computed by (today) | Finished form • / tier | Read surface | Strategy verdict |
|---|---|---|---|---|---|---|
| 1 | **Readiness + contributors** | (derived from #3–#7, #17) | `computeReadinessComposite` (`readiness-composite.ts`) — live; persisted as cache | • `oura_daily_derived.readiness_*`; live route `readiness-score` | readiness screen, weekly-digest, health-insight, ai-chat, running-plan gate, training-stress | **Own** |
| 2 | **Sleep score** | (from `sleep_sessions`) | `computeSleepScore` (`sleep-score.ts`) — live + persisted | • `oura_daily_derived.sleep_score`; live route | sleep screen, weekly-digest, health-insight | **Own** |
| 3 | **Sleep stages / hypnogram** | `0x72` motion, `0x80/0x60` IBI, `0x8b/0x6f` SpO₂ (+`0x4b/4e/5a` if present, dormant on Ring 5) | **SleepNet** (`sleepNetStages5Min` @4383) replaces heuristic `stageSleepDetailed` | • `sleep_sessions.sleep_phase_5_min` (5-min epochs) | hypnogram component, sleep card | **KEEP SleepNet** |
| 4 | **HRV — nightly** | `0x5d` (ring's own 5-min rMSSD) | `medianGated` MET-excluded (@4439) — **not** IBI-recomputed | • `body_metrics.hrv_ms`, `sleep_sessions.average_hrv_ms`; baseline `oura_daily_summary.hrv_*` | RHR/HRV/SpO₂ card, weekly-digest, health-insight | **Own** (validate vs H10) |
| 4b | **HRV — intraday** | `0x80/0x60` IBI | `computeHrv5MinSeries` (`hrv-5min.ts` @4528) → chronic stress; `buildDaytimeStressSeries` | 5-min tier / live-recompute (`rr_intervals` for strap) | heart-rate sparkline, body-battery | **Own** |
| 5 | **Resting HR** | `0x80/0x60` `hr_bpm` | lowest non-MET 5-min bin avg, ≥3 beats (@4267) — a finished form, not a ladder min | • `body_metrics.resting_heart_rate`; baseline `oura_daily_summary.rhr_*` | RHR card, health-insight, training-stress | **Own** |
| 6 | **HR time series** | `0x80/0x60` + `0x86` aohr | 5-min bins; **15-sec inside workout ±10 min** (@4679) | • `oura_heartrate` (source `ble`), ~180-day prune | heart-rate chart, body-battery | **Own** |
| 7 | **SpO₂** | `0x6f` firmware % **else** `0x8b` R→`spo2PctFromR` | daily mean, band 70–100 (@4589) | • `body_metrics.spo2_pct` | RHR/HRV/SpO₂ card, ai-chat | **Own\*** (Ring-5 coeffs to confirm) |
| 8 | **Skin temp + deviation** | `0x75/0x46/0x69` `temps_c` | `nightlyTemperatureCentiC` + `temperature-baseline.ts` sliding median | • `oura_daily_summary.temp_dev_c` (fallback frozen `oura_daily.temperature_deviation`) | readiness-breakdown (ble/cloud badge), health-insight | **Own** |
| 9 | **Respiratory rate** | `0x80/0x60` IBI (RSA) | `breathingFromIbi` (`breathing-rate.ts` @4331) | • `sleep_sessions.respiratory_rate`; baseline `oura_daily_summary.breath_avg_rpm` | breathing-rate sheet; feeds illness `breathZ` | **Own** |
| 10 | **BDI / apnea** | SleepNet apnea head (`0x80` + `0x72`) | `bdiFromApnea` (@4841) | `oura_daily_derived.bdi_derived` | **⚠ produced, UNCONSUMED** (no read surface) | **KEEP** (SleepNet by-product) |
| 10b | **Illness radar** | temp `0x46/69/75`, IBI `0x80/60`, resp/RHR (via daily-summary z-scores) | `computeIllnessRadar` (`illness-radar.ts:101`, **deterministic** — NOT the dormant `illness_detection` ONNX) — live @readiness-score:308 + persisted | • `oura_daily_derived.illness_flag/_score/_biomarkers` | illness advisory banner, readiness detail, weekly-digest, health-insight, ai-chat, health-alerts, running recovery-gate, ai-periodization | **Own** |
| 11 | **Resilience** | daytime-stress series + contributors, 21-day | `computeResilienceForDay` (`stress-resilience.ts`, deterministic port) — **but its input uses dHRV ONNX** | • `oura_daily_derived.resilience_*` | health-score-detail, weekly-digest, ai-chat | **Own** (dHRV = oracle, replace) |
| 12 | **Chronic stress** | 31-night summaries + stashed signals | `runCumulativeStress` (`cumulative-stress.ts`, deterministic port @4971) | `oura_daily_derived.chronic_stress_*` | **⚠ produced, UNCONSUMED** | **Own** |
| 12b | **Daytime stress** | `0x50` MET, `0x80/60/86` HR, `0x46/69/75` temp | `buildDaytimeStressSeries` → **dHRV ONNX** per 30-min bucket (@4910) | • `oura_daily_derived.daytime_stress_scaled`, live body-battery | body-battery stress strip, activity screen, weekly-digest | **Own** (dHRV = oracle) |
| 13 | **Body battery** | HR series + readiness/sleep anchor | live walk (`body-battery/route.ts`) | live; write-through `body_battery_daily` (unread, tuning) | body-battery card, oura chip | **Own** |
| 14 | **Activity / MET / active time** | `0x50` MET | `metActiveWindows` + `computeActivityScore`/`blendActivityScore` | • `oura_daily_summary.met_avg`, `oura_daily_derived.activity_score`, `oura_daily` activity fields | activity screen, health-insight | **Own** |
| 15 | **Steps** | `0x7e/0x7f` gait features + `step_live_windows` | **flat 30-steps/window heuristic** (`estimateSteps`→`mergeStepSources` @4663) — over-counts | • `body_metrics.steps` | steps tile, activity history | **KEEP step_counter** (⚠ not yet wired) |
| 16 | **Energy / calories** | `0x50` MET + logged food | `daily-energy.ts` (MET×time/Schofield) — the ONNX energy model is **dormant** | • `body_metrics.calories`, `oura_daily.active/total_calories`; `oura_daily_derived.active_calories_est` (unread) | energy-budget card, health-insight | **Own** |
| 17 | **Training load (ACWR / OTS)** | workout sessions (not ring) | `computeVolumeAcwr` (live); `computeTrainingStress` (`training-stress.ts`, deterministic port) | • live; persisted `oura_daily_derived.training_load_ots` | training-load/stress cards, weekly-digest, running gate | **Own** |
| 18 | **Wear time / non-wear** | HR-beat density; temp ≥31 °C | 15-min bins → non-wear (@4745) | • `oura_daily.non_wear_time_sec`; `oura_daily_derived.worn_hours_ble` (unread) | wear-time sparkline; gates baselines | **Own** |
| 19 | **Body composition** | logged weight + body-fat (**not ring**) | `body-composition.ts` (Cunningham/Mifflin formula) — live in-component | display = **live formula**; `oura_daily_derived.body_comp` (atlas model, unread) | body-comp tile | **DROP model** (keep formula tile) |
| 20 | **Vascular age / PWV** | (would need raw PPG `0x81/64/68`) | **no live producer — no model wired** | frozen `oura_daily.vascular_age` shown "as of \<date\>"; `_derived.vascular_age/pwv` never written | heart-rate page (frozen only) | **DROP** |

**Reading of the table.** Of 21 metrics, **18 are already fully ours**; only sleep *staging* (SleepNet)
and *steps* (step_counter) keep an Oura ML model — both the exact cases where our own logic is provably
worse — and vascular-age is dropped outright (no owned replacement; a training app doesn't need it).
Crucially, **illness is owned deterministic math** (`computeIllnessRadar`), *not* the dormant
`illness_detection` ONNX in the §6 oracle list — do not conflate them. Body-comp is a formula off logged
weight (its ONNX was never wired). Five derived fields are **produced-but-unconsumed** (BDI,
chronic-stress, `active_calories_est`, `worn_hours_ble`, `pwv`) — analysis snapshots with no reader; keep
persisting (cheap, future-analysis) but they don't drive UI. **Illness is NOT in that class** — it has
seven-plus live read surfaces.

---

## 3. Per-tag keep / cull matrix (the "what raw & for how long" answer)

Verdict legend:
- **keep-raw** — `body_hex` retained on device **storage-aware** (prune-last); actively decoded/consumed by
  an owned metric or a kept model. Reprocessable with a better decoder/model. *Never on Railway.*
- **keep-hex-only** — archived `body_hex`, **not currently decoded**; plausibly future-decodable. Prune
  **first** under storage pressure; re-evaluate at each decoder-stabilisation checkpoint.
- **cull-now** — no analytical or re-decode value; already dropped at ingest (`RAW_STORAGE_DROP_TAGS`).
  Historical rows purgeable (small, safe).
- **cull-after-window** — feeds **only a dropped metric** or is decoded-but-unused; retain through
  `max(decoders-stabilised, ~2–3-month oracle deprecation)`, then cull-eligible. **Any body_hex drop →
  owner confirmation.**

Row counts are the production `oura_raw_samples` audit (`db-volume-cleanup-handover.md` §2).

### 3a. Rollup-consumed biometric tags → **keep-raw** (the core retained set)

| Tag | Event | ~Rows | Feeds (owned unless noted) | Kept-model dependency | Verdict |
|---|---|---|---|---|---|
| `0x8b` | spo2_r_pi | **103k** | SpO₂ (`spo2PctFromR`) **+ SleepNet SpO₂ channel** | **SleepNet** | keep-raw |
| `0x60` | ibi_and_amplitude | **81k** | HR, RHR, resp-rate, LF/HF, intraday HRV, **SleepNet IBI** | **SleepNet** | keep-raw |
| `0x80` | green_ibi_quality | **39k** | HR, RHR, resp-rate, chronic-stress, **SleepNet IBI**, BDI | **SleepNet** | keep-raw |
| `0x7e` | real_step_feature_1 | **17.7k** | Steps (backfills full history via redecode) | **step_counter** (TODO) | keep-raw |
| `0x7f` | real_step_feature_2 | **17.7k** | Steps | **step_counter** (TODO) | keep-raw |
| `0x72` | sleep_acm_period | **15k** | **SleepNet motion (low_res)** + heuristic stager | **SleepNet** | keep-raw |
| `0x5d` | hrv_event | — | **nightly HRV** (medianGated) + dHRV features | — | keep-raw |
| `0x6f` | spo2_event | — | SpO₂ (firmware %, preferred) + SleepNet channel | SleepNet | keep-raw |
| `0x86` | aohr_event | — | daytime/awake HR series + dHRV | — | keep-raw |
| `0x46` | temp_event | — | skin temp/deviation + dHRV + heuristic stager | — | keep-raw |
| `0x69` | temp_period | — | skin temp | — | keep-raw |
| `0x75` | sleep_temp_event | — | nightly skin temp + heuristic stager | — | keep-raw |
| `0x50` | activity_information | — | **MET** (+ gates HRV/RHR), energy, activity score, dHRV | — | keep-raw |
| `0x76` | bedtime_period | — | sleep-window detection | — | keep-raw |
| `0x47` | motion_event | **24.5k** | **step_counter motion stream** (soft input, `step-counter-pipeline.ts:49,66`) — NOT read by `aggregateOuraRawSamples` | **step_counter** (TODO) | keep-raw |
| `0x4b`/`0x4e`/`0x5a` | sleep_phase_* | ~0 | ring's own stages (dormant on Ring 5; rollup prefers them if present) | — | keep-raw (negligible) |

Not rollup-consumed, retained separately by the drop-set subtype exception (not part of this keep-raw
set, listed here only to disambiguate): **`0x61` battery subtypes** — `shouldDropRawEvent` keeps
`charging_time`/`battery_level_changed` for the ring-battery/wear UI; every non-battery `0x61` body is
dropped. Verdict: keep the battery subtypes (small), cull the rest (already dropped at ingest).

> **Source-of-truth note (L-2):** the authoritative consumed set is **`ROLLUP_CONSUMED_TAGS`**
> (`lib/oura-ble/rollup-consumed-tags.ts`), which includes `0x7e/0x7f`. The inline `ROLLUP_TAGS`
> (`adapter.ts:4068`) omits the step-feature tags because they're fetched by a **separate** step query
> (`:4626`) — verifying against the inline constant alone would wrongly read steps as unconsumed.

**Key finding:** the owned-metric set + the two kept models together consume **essentially the whole
biometric tag spectrum**, so nearly all biometric raw is keep-raw regardless of the own-vs-keep split.
Replacing **dHRV** with our own daytime-HRV logic (`lib/health/daytime-hrv.ts` / `hrv-frequency.ts` already
exist) **frees no raw** — dHRV's inputs (`0x46/69/75`, `0x50`, `0x80/60/86`) are all independently keep-raw
for owned metrics. Likewise the dormant Oura oracle models, run offline during validation, read the same
keep-raw tags. **So the oracle-deprecation window does not shrink the retained raw set** — the retained set
is fixed by what we *keep and own*, not by the oracle.

### 3b. Telemetry / debug / state tags → **cull-now** (already dropped at ingest)

`RAW_STORAGE_DROP_TAGS` (`raw-storage.ts:13`): `0x42` time_sync, `0x43` debug_event (**~32k historical**),
`0x45` state_change, `0x53` wear_event, `0x56` alert, `0x5b` ble_connection, `0x61` debug_data (**~49k**;
battery subtypes exempted), `0x79` self_test_data, `0x82` scan_start, `0x83` scan_end. **Verdict: cull-now**
— dropped going forward; the ~80k historical `0x43`/`0x61`-debug rows are a trivial one-off purge win
(safe, no biometric value). No device retention.

### 3c. Dropped-metric-only & decoded-but-unused tags → **cull-after-window** (owner-confirm)

These are the *only* biometric-adjacent cull levers, and the only place the oracle/decoder-stabilisation
window actually bites.

| Tag | Event | ~Rows | Only-consumer / status | Why cull-eligible | Verdict |
|---|---|---|---|---|---|
| `0x73` | ehr_trace_event | **14k** | **no decoder**, archived, not dropped | no consumer; future-decodable | keep-hex-only → cull-after-window |
| `0x81` | cva_raw_ppg | low | raw PPG → **vascular-age (DROPPED)** | vascular-age not a training metric; no other consumer | cull-after-window |
| `0x64`/`0x68` | raw_ppg | low | raw PPG, **no decoder** → vascular-age/BP (dropped) | same | cull-after-window |
| `0x87`/`0x88` | atlas bioZ | low | bioimpedance → **body-comp model (DROPPED)** | body-comp tile is a formula off logged weight; bioZ unused | cull-after-window |
| `0x49/0x4c/0x4f/0x58` | sleep_summary_1–4 | low | ring's own sleep summary, unvalidated decoders | we own sleep + keep SleepNet; possible future validation input | keep-hex-only |
| `0x59/0x74/0x6b/0x6c/0x84` | eda/intensity/motion_period/feature_session/ambient | low | decoded, no consumer | future-decodable, small | keep-hex-only |

**The retention window for 3c** = `max(decoders-stabilised, oracle-deprecation ≈ 2–3 months)` — **and the
~2–3-month figure is an unvalidated estimate, not a settled bound** (owner decision, §8). Rationale:
(a) until our own decoders + models are golden-stable we might still want to reprocess; (b) the Oura
reference oracle (which could, in principle, re-examine these) is deleted at ~T+3mo. After that window, 3c
raw has no consumer on any horizon we plan to build → cull-eligible. **After removing `0x47` (it feeds the
kept `step_counter` model — §3a), the largest genuine cull lever here is `0x73 ehr_trace` (14k, no
decoder)** — but even that is a `keep-hex-only` future-decodable candidate, so the cull-after-window set is
small. The real space win is the **server raw drop (§3d)**, not device-side biometric culling.

### 3d. The server axis — Railway raw → **cull entirely** (the db-volume solution)

Independent of the per-device verdicts above, **all raw leaves Railway.** Sequence (Phase-0 §6, unchanged,
confirm-first): pull the 437k rows to device `oura_raw.db` (paginated, dedup-safe) → per-day finished-form
completeness audit (the normal rollup is 35-day-windowed and `fullHistory` **times out at the gateway**, so
this needs a batched backfill, not one call) → **staged rename-then-drop** (not a hard `DROP`) → reclaim via
the existing admin `VACUUM FULL` path. Reconcile with the parallel `body_hex`→`bytea` migration
(`db-volume-cleanup-handover.md` §5a) — these are **mutually exclusive and the choice is an open owner
decision** (§8): if raw is leaving Railway anyway, the bytea migration is wasted work (recommend: do the
drop, skip bytea); but if the server-raw cutover slips, bytea is the interim halving. **This is the change
that solves the original 1 GB
volume crisis** (`oura_raw_samples` = 91% of the DB, +50 MB/week).

---

## 4. Finished-form persistence & the backup subset (the "what tier / what backup" answer)

### 4.1 Displayed metrics read finished forms; the bucket ladder is supplementary

A critical correction the Phase-0 review already pinned and the code confirms: **the authoritative
displayed values are finished daily/nightly forms, not the `oura_bucket` ladder.**
- **RHR** = lowest non-MET 5-min bin, deliberately *not* a raw min → a coarse-tier `hr_min` is a
  **forbidden artifact**, not the RHR.
- **Nightly HRV** = `medianGated` over `0x5d`, MET-scoped → *not* a bucket average.
- **Steps** = raw-hex-dependent max-merge, **not a ladder sum** → stays a per-day finished form; drop
  `steps` as a bucket field.
- **Intraday HR** is owned by **`oura_heartrate`** (which carries 15-sec workout bins the fixed ladder
  can't represent), **not** the bucket — so the two must be **non-overlapping** on Railway.

So the `oura_bucket` ladder's real job is **extra trend resolution** for the continuously-binned series
(HR mean/min/max, SpO₂, MET mean+minutes, skin-temp, motion_mad) at tiers the finished forms don't hold:
fine tiers (10s/1min/5min) are device-only bonus resolution the server never had; coarse tiers (≥30min)
are the long-horizon trend. MET gating must be consumed at fine resolution **before** promotion (a bucket
`met_mean` hides the >1.8 threshold crossings that gate HRV/RHR windows).

### 4.2 The backup subset (restore set) — finished forms only

| Data class | Device | Railway backup | Rationale |
|---|---|---|---|
| Raw `body_hex` | source of truth, single copy, storage-aware | **never** | archival; reprocess source |
| Fine bucket tiers (10s/1min/5min) | source of truth | **never** | never existed on server; acceptable to lose |
| `sleep_sessions` (full — incl. all Oura cols) | local-first | **yes** | per-night hypnogram + physiology |
| `body_metrics` (Oura cols: hrv/rhr/spo2/steps/active_cal) | local-first | **yes** (per-column source-merge!) | daily scalars |
| `oura_daily` (non_wear + scores/contributors) | local-first | **yes** | day scores |
| **`oura_daily_summary`** (physiology + 8× EMA baselines) | local-first | **yes** | **load-bearing** — feeds readiness z-scores + illness |
| **`oura_daily_derived`** (resilience/illness/chronic/BDI/OTS/body_comp) | local-first | **yes** | derived analysis record |
| `oura_heartrate` (5-min + 15-sec-workout) | local-first | **yes** | intraday HR |
| `oura_bucket` **coarse tiers ≥30 min** | local-first | **yes** | long-horizon trend (non-overlapping w/ `oura_heartrate`) |

**Multi-source caveat (must not clobber):** `body_metrics` and `oura_daily` are per-column `sourceMap`
priority merges — a device push writer **must mirror the COALESCE merge** or it deletes manual
weight/body-fat and Health-Connect steps (the sync-push-mirrors-web-route rule). One shared write fn per
domain; `check-push-mutations.js` enforces no raw `sql` in `pushMutations`.

### 4.3 The durability gap that blocks the restore subset (highest-priority downstream work)

Verified against code (correcting the handover — see §10): today the sync delta carries **`sleepSessions`
(full) and `ouraDaily` (reduced 8-col)** among Oura tables. **`oura_daily_summary`, `oura_daily_derived`,
`oura_heartrate`, and `oura_bucket` have no pull-delta domain at all** — they are server-side-only and
**not restorable.** And `getSyncDelta` **clamps every pull to 90 days** (`adapter.ts:2970`), so even a full
resync can't restore older history. Until both are fixed, dropping server raw (§3d) would leave every
derived metric **single-copy on the fragile local store** (documented silently-dead-twice). **The
prerequisite for the whole inversion** is therefore: build the six-form offline chain (local table +
`sync_status` + clobber-guard = payload = shared write fn in `pushMutations` = `getSyncDelta` = `pullDelta`
= `applyDelta`) **and** a full-history restore path bypassing the 90-day clamp. This is the largest
correctness surface in the project — it is Phase-2's job, and this map is its input.

---

## 5. Reconcile with existing tables — subsume, don't duplicate

Server vs local (verified `schema.ts` vs `lib/sqlite/migrations.ts`, local DB **v18**):

| Table | Server | Local (v18) | Note |
|---|---|---|---|
| `oura_daily` | ~40 cols | reduced (8 cols) — read cache | subsumes: keep reduced local shape |
| `oura_daily_summary` | 30 cols (mig 116) | **full mirror** (v17, recreated v18) | ready — needs sync-wiring |
| `oura_daily_derived` | 40 cols (mig 123/127/128) | **full mirror** (v17, recreated v18) | ready — needs sync-wiring |
| `sleep_sessions` | 23 cols | base + Oura cols via **RECONCILE** (no versioned migration) | already sync-wired (full) |
| `body_metrics` | 27 cols | reduced (no `active_calories`/`source_map`) | sync-wired; add `active_calories` |
| `oura_heartrate` | 5 cols (mig 090) | mirror (`ts_ms` PK) (v17) | ready — needs sync-wiring |
| `oura_bucket` | — | **net-new local** (PK `tier,bucket_start_ms`) | device-only ladder; coarse tiers back up |
| `oura_accel_chunks`, `step_live_windows`, `rr_intervals`, `oura_workouts`, `oura_tags`, `oura_ble_clock_anchors`, `oura_raw_samples` | present | **absent locally** | raw → native `oura_raw.db`; clock-anchor → on-device forward-only |

The local finished tables already **exist** (v17) and are faithful mirrors (v18 fixed the `oura_bucket` PK
bug + type drift) — so the on-device model **subsumes** the server tables rather than inventing new ones.
The remaining work is *wiring* (sync domains + RECONCILE registration — the mirror tables are in
`RECONCILE_TABLES`; `oura_bucket` and its index too), not schema.

---

## 6. What this means for the model strategy (the discussion)

**Kept models (graduate to permanent):**
- **SleepNet** (`sleepnet_moonstone_1_2_0_core.onnx`, 8 MB) — wired live; the only source of accurate REM
  staging + BDI. Its inputs (`0x8b/0x6f` SpO₂, `0x80/0x60` IBI, `0x72` motion) are **keep-raw**. On-device
  it runs via `onnxruntime-web` (WASM parity gate already passed, #722).
- **step_counter** (`step_counter_1_3_0_core.onnx`, 335 KB) — **exists but wired only to an admin
  validation route; NOT the rollup.** Today's live steps use the flat 30-steps/window heuristic that
  over-counts. **Wiring `steps_motion_decoder` → `step_counter` as primary is a concrete TODO**
  (strategy §5); it backfills the entire step history from archived `0x7e/0x7f` via redecode. Its inputs
  are **keep-raw**.

**The temporary oracle (observe-never-feed, delete ~T+3mo):** the dormant vendored models — `sleepnet_bdi`
(×2), `energy_expenditure` (×2), `illness_detection`, `awhr_imputation`, `awhr_profile_selector` — plus the
one *wired* oracle, **dHRV**. **Note:** the dormant `illness_detection` ONNX is a *different thing* from our
live illness metric — the shipped illness radar is owned deterministic math (`computeIllnessRadar`, §2 #10b)
with 7+ read surfaces; deleting the ONNX oracle does not touch it. The rule (strategy §2): the reference **only observes**; our interpretation
computes with zero knowledge it exists (no fallback, no blend), so deprecation is a one-line deletion of the
adapters + weights + `onnxruntime`. **dHRV is the exception that needs active replacement** — it's wired
into resilience today, so "own resilience/stress" requires porting daytime-HRV to our own logic before dHRV
can leave. Removing the oracle **does not reduce raw retention** (§3a).

**Dropped (nothing to remove in live code):** vascular-age/PWV (no model ever wired — only frozen Cloud
values + parked raw weights), body-comp bioimpedance (`atlas` never exported; the tile is a formula), ring
activity-type auto-tag (`astd`/`awhr_profile_selector` dormant). Dropping these = deleting vendored
artifacts + the `cull-after-window` raw (`0x81/64/68/87/88`), owner-confirmed.

**Capability honesty (parity review):** two metrics are *owned but not identical* to Oura's, and neither is
a regression: (1) our **illness radar** is a 4-nightly-z-score heuristic (temp+HRV+RHR+breath) vs Oura's
8-channel×30-step CNN — coarser, but the CNN never ran, so the heuristic is the already-shipped behaviour;
(2) **awake-HR gap-filling** (`awhr_imputation`) is a capability we are **declining, not replacing** — our
HR series shows measured 5-min bins with gaps. State this so a future "why are there HR holes / why is
illness coarser" isn't mistaken for a regression. The one metric needing a *real build before* dHRV can be
retired is **daytime-HRV** (feeds resilience/body-battery) — see the master plan D5 (validate on Polar H10,
not against dHRV).

**The circular-validation escape:** the vendored models are Oura's *opinion*, not truth — they catch gross
wrongness but can't tell us Oura was right. Wire a **Polar H10 chest strap** (`polar-h10-ble` skill;
`rr_intervals` table already exists, mig 124) as a **non-Oura cardiac validation reference** — an
**intermittent spot-check** worn for short bursts during tuning/testing to catch when *our* HRV/RHR/HR
logic diverges. **It is NOT a data source in the pipeline, NOT the primary source of truth, and NOT a
longitudinal record** — the **ring stays the primary/continuous source of truth** and **our own math carries
longevity**. The H10's only job is to break the circular-validation loop (validate against something other
than the Oura opinion we're escaping); it never feeds a stored metric or replaces the ring. It's the one
*reference* that can outlive the ~3-month oracle guardrail — as a test instrument, not a source.

---

## 7. Retention windows — the two bounds, stated

| Class | Window | Bound by |
|---|---|---|
| keep-raw (owned + kept-model tags, §3a) | **storage-aware — effectively indefinite** | device storage pressure only (prune oldest, surfaced in storage UI) |
| keep-hex-only (future-decodable, §3c partial) | storage-aware, **prune-first** | re-evaluate at each decoder-stabilisation checkpoint |
| cull-after-window (dropped-metric/unused, §3c) | `max(decoders-stabilised, ~2–3-month oracle deprecation)` | then cull-eligible, **owner-confirm** |
| cull-now (telemetry, §3b) | none | already dropped at ingest |
| Railway raw (§3d) | until device-pull + finished-form-completeness audit + backup-chain proven | then drop, **owner-confirm** |

"Storage-aware, indefinite" is deliberate and is the point of *future-proof*: the day we ship a better
decoder or a new model version (SleepNet/step/illness/dHRV are all versioned), a **redecode pass** re-derives
history from archived `body_hex` — but only over the raw window still on device. Keep-raw maximizes that
window; the cull verdicts bound the raw with no reprocess value.

---

## 8. Open owner decisions (pre-implementation) & guardrails

**Genuinely-open decisions that shape the plan (not yet settled — surface before/at implementation):**
- **O1 — server-raw strategy: drop-after-device-pull vs `bytea` migration.** Mutually exclusive (§3d).
  Recommend drop (raw belongs on device); bytea only if the cutover slips. *Post-implementation confirm*
  for the actual `DROP` (destructive).
- **O2 — the `cull-after-window` set** (§3c: `0x73`, raw PPG `0x81/64/68`, atlas bioZ `0x87/88`) and the
  **retention window itself** (~2–3-month figure is an estimate). No biometric `body_hex` drop happens
  without owner confirm. *Small lever — safe to defer.*
- **O3 — step_counter as primary steps.** The model is unwired and unverified on-device; adopting it
  replaces the visible (over-counting) heuristic. Needs the redecode-backfill + on-device sanity check
  before flip. *Recommend proceeding — it fixes a live bug — but it is not a silent given.*
- **O4 — coarse-bucket backup.** Whether the ≥30-min `oura_bucket` tiers are worth syncing to Railway on
  top of the finished forms (Phase-0 Q3 marked resolved, but revisit under the backup-cost lens).

**Guardrails (do NOT proceed without these):**

1. **`body_hex` is archival/immutable** until an **owner-confirmed** policy change. Nothing in §3c/§3d
   executes here. Any PR that drops a biometric tag or `body_hex` **rewrites the CLAUDE.md "never prune
   body_hex" rule in the same PR** and is confirm-first.
2. **No cron layer exists** — all recurring/rollup/prune work fires from **app-foreground / BLE-sync
   completion**, never a scheduler (module-map §0). The device-side tier promotion + prune obey this.
3. **Next free Postgres migration = 136** (highest on disk 135; the `130` gap is claimable but claim
   forward per the collision rule; no open PR — #731/#729/#426/#371 — claims a number above 135). Local
   SQLite is at **v18** (next v19). **This doc ships neither.**
4. **Keep the web fallback logic-free** (Canonical Runtime): the online-only read path is a pure
   fetch→render pass-through, no defaults/derivations/band-math/write-semantics.
5. **Sync-push mirrors the web route** for every new backed-up domain (one shared write fn;
   `check-push-mutations.js`); the `oura_raw.db` store sits **outside** `RECONCILE_TABLES`/`check-reconcile.js`
   and needs its own idempotent-`ADD COLUMN` + reconcile discipline.

## 9. Device-verification flags (owner's S25 required — sandbox can't reach these)

Everything below is **unverified in the sandbox** (web renders insets as 0, native SQLite/Capacitor return
null, no real ring/BLE, fresh local seed masks prod drift):
- **step_counter wiring** — that `steps_motion_decoder → step_counter` produces sane daily totals on real
  `0x7e/0x7f` frames and the redecode backfill matches (the over-count fix is only provable on-device).
- **`oura_raw.db` native store** — concurrent native-write + WebView-read, `synchronous=FULL` durability,
  cursor-in-raw-DB co-location, disk-full alarm.
- **SleepNet WASM on-device** — nightly perf/battery of an 8 MB model on the S25 (float parity already
  proven, #722; runtime cost is not).
- **The finished-form offline chain + full-history restore** (§4.3) — the actual push/pull/restore on real
  data; the largest correctness surface.
- **Backup-completeness audit before any server raw drop** (§3d) — per-day finished-form coverage across
  all history, given the 35-day rollup window + gateway timeout.
Run `docs/device-smoke-checklist.md` + the ops-doc §4 1:1 verification for each before marking any of these
done; otherwise add a NOT-verified Known-Issues row per the Canonical Runtime rule.

## 10. Corrections to prior docs (code beat the prose)

The five source audits falsified several handover/spec claims. Recorded so downstream planning trusts the
code, not the stale prose:

- **C1 — SyncDelta.** Handover: *"carries only `sleepSessions` + `ouraDaily`, both reduced subsets."*
  **Wrong.** `SyncDelta` carries **24 domains** (`repository.ts:213`); `sleepSessions` is a **full** select
  (`adapter.ts:2994`), only `ouraDaily` is reduced (8 cols, `:3096`). The real gap: `oura_daily_summary`,
  `oura_daily_derived`, `oura_heartrate`, `oura_bucket` are **not in the delta at all** (§4.3).
- **C2 — local v18.** Phase-0/handover: *"v18 added the finished tables."* **Wrong.** The mirror tables
  were added in **v17** (`migrations.ts:961`); **v18 is a corrective** migration that **drops + recreates
  three tables** (`oura_bucket`, `oura_daily_summary`, `oura_daily_derived`) to fix the `oura_bucket` PK +
  type drift (`:972-982`). Oura columns on local `sleep_sessions` are added via `RECONCILE_COLUMNS` with
  **no version bump** (`:306`).
- **C3 — the two live models.** Confirmed **SleepNet + dHRV** are the only ONNX in the rollup. step_counter
  is **admin-route-only** (not the rollup, as some prose implied it might be); energy/illness/awhr/bdi ONNX
  are dormant/test-only. BDI comes from SleepNet's apnea head via `bdiFromApnea`, **not** the `sleepnet_bdi`
  cores.
- **C4 — steps.** Confirmed the Phase-0 pin: steps is a raw-hex max-merge, **not** a bucket "sum"; drop it
  as a bucket field. And today's live path is the **flat-30 heuristic**, not step_counter.
- **C5 — five produced-but-unconsumed derived fields** (BDI, chronic-stress, `active_calories_est`,
  `worn_hours_ble`, `pwv`) — persisted + read-mapped but **no UI/AI/route reads them**. Not a bug; note it
  so they aren't mistaken for load-bearing.

---

## 11. Backlog / next steps (this map is the foundation, not the build)

This is a docs-only audit. It unblocks, in priority order:
1. **Wire the six-form offline chain + full-history restore** (§4.3) — the durability prerequisite for the
   whole inversion; Phase-2's core. *Blocks the server raw drop.*
2. **Wire `steps_motion_decoder → step_counter` as primary steps + redecode backfill** (§6) —
   highest-value, verifiable, fixes the live over-count.
3. **Server raw cutover** (§3d) — pull-to-device → completeness audit → staged drop (confirm-first);
   reconcile with / supersede the bytea migration.
4. **Owner decision on the `cull-after-window` set** (§3c/O2) — `0x73` + raw PPG + atlas bioZ (small lever;
   `0x47` is NOT here — it feeds step_counter); confirm the retention window + CLAUDE.md rule change first.
5. **Port daytime-HRV to our own logic to retire dHRV** (§6) — the one wired oracle needing active
   replacement.
6. **Wire the Polar H10 truth reference** (§6) — escape circular validation.

A one-line entry has been added to `docs/implementation-backlog.md`.
