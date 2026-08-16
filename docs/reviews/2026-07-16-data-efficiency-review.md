# Data-Efficiency Review — is every ingested signal used where it should be?

**Date:** 2026-07-16 · **Scope:** every ingested/stored health signal (Oura BLE, legacy Oura
Cloud, Health Connect, manual logs, workouts/activity) mapped against every consumer
(readiness composite, illness radar, daytime stress, Body Battery, sleep pipeline, training
load, AI periodization/chat/digests, display surfaces). Owner ask: "make sure all the
information we ingest is used as efficiently as it can be — stress/illness/HRV contributing
to everything they need to."

**Method:** six parallel code-mapping passes (readiness/illness inputs, Body Battery + stress,
sleep pipeline, AI-layer consumption, ingestion/dead-data inventory, display surfaces), each
finding verified against source with file:line evidence; conflicting claims re-checked by hand.
Findings already covered by queued backlog items are reconciled in §7, not re-raised.

---

## 0. Verdict in one paragraph

The measurement layer is in excellent shape — HRV/RHR/temp are quality-gated and baselined,
sleep is neurally staged, illness is flagged, stress is modelled. The waste is almost entirely
**one-way pipes**: signals are computed and persisted, then consumed by exactly one surface (or
none) while sibling consumers run on worse proxies or frozen Cloud-era data. The three biggest
wins: (1) **`oura_daily_derived` is write-only** — nothing reads the persisted
readiness/illness/body-comp records, while the 14-day score sparklines read the frozen
`oura_daily` Cloud columns and render **null for every day since the 2026-07-07 re-key**;
(2) **illness radar and daytime stress reach zero decision layers** — no AI periodization
signal, no deload gate, no chat tool, no digest; (3) **Body Battery anchors on frozen Cloud
scores** and silently defaults to 50 on BLE-only days while our own composite exists one route
over.

---

## 1. Computed/stored but read by nothing (dead outputs)

### 1.1 `oura_daily_derived` is a write-only table — HIGH
`getOuraDailyDerived` has **no production caller** — only the interface
(`lib/data/repository.ts:727`), the adapter/slice plumbing, and tests. Everything persisted
there is currently unread:
- `illness_flag/score/biomarkers` — written by the rollup (`adapter.ts:4370`); the readiness
  route *recomputes* illness live from summaries instead of reading it back.
- `readiness_score/contributors/source` — written by the readiness route (`route.ts:342-352`),
  never read. (Read-first on the route itself is deliberately perf-gated — P-E §2.3 — but no
  *other* surface reads it either; see §3.1 for the sparkline fix this enables.)
- `body_comp` JSONB — written by `persistBodyCompFromMetrics` (`slices/oura.ts:800`), never
  read; the Body-Composition card recomputes client-side.
- `daytime_stress_scaled / stress_high_minutes / chronic_stress_score / resilience_level /
  training_load_ots / vascular_age / pwv / activity_score` — **never written and never read**
  (schema-only; P-E P2/P3 and P-D will populate some).

### 1.2 Respiratory rate: computed nightly, baselined nowhere — HIGH
The rollup computes a real per-night breaths/min (median `breathingFromIbi`,
`adapter.ts:3936-3943`) into `sleep_sessions.respiratory_rate`, and its **only** consumer is one
display chip (`sleep-card.tsx:73`). It is one of Oura's own 7 illness biomarkers, and
`illness-radar.ts:11-13` explicitly documents the omission ("we carry no breathing baseline
yet"). `NightInput` (`daily-summary.ts:11-27`) has no breathing field, so it is never baselined,
never a readiness input, never an illness biomarker — despite the radar renormalising weights
over present biomarkers (`illness-radar.ts:110-114`), which makes a fourth biomarker close to
drop-in once a baseline column exists on `oura_daily_summary`.

### 1.3 Own sleep-score contributors computed then discarded — MEDIUM
`computeSleepScore(lastSleep)` runs on every readiness read (`readiness-score/route.ts:152`)
but only `.score` is used — the per-contributor `components` are thrown away. Meanwhile the
Sleep detail page's contributor bars read `oura_daily.sleep_contributors` (**frozen Cloud**),
so on BLE nights the bars are empty while the strictly better breakdown was just computed and
discarded. (P-C plans a completed-form sleep-score persist — this is the same fix; the
`oura_daily_derived.sleep_score/sleep_contributors` columns already exist and are never
written in production.)

### 1.4 Daytime stress: modelled, then reduced to one drain number — MEDIUM
`buildDaytimeStressSeries` (dHRV engine) runs inline on every Body Battery read; the full
intraday `relStress` series is discarded after the walk — only `{current, draining,
extraDrained}` survive (`body-battery/route.ts:237-243`), surfacing as a single drain line in
the expanded card when `extraDrained > 0`. No stress value/score, no intraday stress chart, no
history, no persistence (the `daytime_stress_*` columns in `oura_daily_derived` are unwritten).
P-E P2/P3 covers persistence + cumulative stress/resilience; the *display* and *readiness/AI
wiring* are additional gaps (§2).

### 1.5 Smaller dead outputs — LOW
- **MET baseline fully built, read by nothing:** `oura_daily_summary.met_avg` +
  `met_baseline_*` are computed/carried nightly (`daily-summary.ts:70`,
  `adapter.ts:4339-4357`) but no contributor, radar, or activity signal reads them.
- **`rhr_avg_bpm`** stored per night; only `rhr_low_bpm` is used.
- **`time_in_bed_hours`** written (`adapter.ts:4067`), zero readers.
- **`body_battery_daily.hr_max_observed`** collected since migration 100 but the reserve calc
  still uses `220 − age` — `docs/body-battery-tuning.md:52-57` calls swapping it in "the single
  biggest accuracy win" (already a Nice-to-have item; noting for completeness).
- **`oura_accel_chunks.magnitudes`** stored for recount/calibration; no reader today (by
  design, 7-day retention — fine, just documented).
- **Decoded-but-unaggregated BLE tags:** 0x59 EDA (the ring's stress-adjacent electrodermal
  stream), 0x47/0x6b motion, 0x74 intensity, 0x81 CVA PPG — decoded and stored with no
  downstream metric. Deliberately retained (owner deferred dropping them 2026-07-16); 0x59 is
  the natural future input for a true stress feature beyond dHRV.
- **`oura_daily_summary.tempDevC`** is selected (`slices/oura.ts:594`) but never written —
  always null.
- **SleepNet apnea head** computed every night, discarded in the production path
  (`sleepnet-assemble.ts:125`); only the admin debug dump renders it. Owner validation handoff
  is already open (v1.152.1) — once validated, §2.1's illness radar is its natural consumer.

---

## 2. Cross-feed gaps — the signal exists, the consumer uses nothing or a worse proxy

### 2.1 Illness radar reaches ZERO decision layers — HIGH
The strongest "don't train hard today" signal in the app is consumed by exactly one line of UI
(the advisory on `/health/readiness`, `health-score-detail.tsx:181-192`) plus a bounded
readiness suppression. It is absent from:
- **AI periodization** — `PrescriptionSignals` (`signals.ts:17-82`) has no illness field; the
  only "illness" in the file is a comment on the SpO₂ trend (`signals.ts:377`).
- **Emergency deload / per-exercise deload / rest-day gate** — gates are soreness, hours,
  ACWR, RPE, rep-completion, sleep/HRV/SpO₂ *trends* (`emergency-deload.ts:26-32`,
  `prompt.ts:148-151`); a `fever`-graded night changes nothing.
- **AI chat** — no tool exposes `illnessFlag/score/biomarkers`; the chat cannot answer "am I
  getting sick?" from the radar it already has.
- **Weekly digest / health-insight** — not in either prompt.
- **Home** — no illness surfacing at all (chips only); a fever flag is invisible unless the
  user opens Health → Readiness.

### 2.2 Daytime/chronic stress feeds nothing but battery drain — HIGH
Not a readiness input (`readiness-score/route.ts` never imports daytime-stress; the route's
`stressHigh` at `:377` is the frozen Cloud field passed through for display). Not in
periodization signals, chat tools, or digests. The next-session engine uses only the coarse
frozen `daySummary === 'very_stressful'` Cloud string (`ai-dynamic.ts:149-170`) — a strictly
worse proxy than the live dHRV series computed daily.

### 2.3 Body Battery feeds no decision layer — MEDIUM
Dedicated table + intraday model, zero AI consumers (not in `signals.ts`, chat tools, or
digests). Also inputs-side gaps: workouts drain it only via generic HR (no session awareness),
steps/MET never drive drain independently, illness/temperature don't modulate it, and
`STRESS_DRAIN_RATE=0.2` + charge/drain constants remain uncalibrated (tracked in
`body-battery-tuning.md`).

### 2.4 AI periodization inconsistencies — MEDIUM
- **Temperature deviation** gates the next-session deload (`ai-dynamic.ts:149-170`) and is in
  chat context + health-insight, but is **absent from the periodization prompt/signals** — the
  layer that actually prescribes load.
- **Sleep is duration-only** in `sleepTrend` (`signals.ts:342-354`) and the weekly digest;
  sleep score/stages/efficiency/consistency are ignored (the richer `computeSleepScore` exists
  and runs daily). Sleep-start consistency (`sleep-consistency.ts`) is display-only.
- **SpO₂** feeds periodization but is invisible to chat (`getRecoveryData` omits it) and
  digests.
- **Mood/subjective check-ins** feed periodization but not the readiness composite (arguably by
  design — physiological purity; decide once and document).

### 2.5 Nutrition never sees measured expenditure — MEDIUM (gated on P-D)
TDEE adaptation is weight-trend-only (`tdee-adaptation.ts:17-23`); goal recommendation uses
steps + workout counts but not active/total calories (`nutrition-goals/recommend/route.ts:56-117`),
and baseline TDEE is a static self-reported multiplier. Post-re-key, `body_metrics.active_calories`
has no live writer anyway (Cloud sync only, `adapter.ts:2915`) — so the readiness activity
score's calorie half also runs empty (§3.3). P-D's energy-expenditure port is the prerequisite;
once it lands, wire it here too, not just into the activity score.

---

## 3. Frozen-Cloud staleness — displays silently showing pre-re-key data

### 3.1 The 14-day score sparklines are dead post-re-key — HIGH
`/api/health/trends` reads `readinessScore/sleepScore/activityScore` **only from `oura_daily`**
(`health/trends/route.ts:70-72`) — columns whose only writers are the frozen Cloud sync/webhook.
Every day since 2026-07-07 renders null in the Sleep/Readiness/Activity sparklines (and any
Cloud-era tail shows a silent discontinuity). Meanwhile the readiness route persists a fresh
composite into `oura_daily_derived` daily (§1.1). **Fix:** the trends route coalesces
`oura_daily_derived` scores over `oura_daily` — this is the first real read-path for the
derived table and makes the persist work pay off.

### 3.2 Body Battery anchor defaults to 50 on BLE days — HIGH
`body-battery/route.ts:107-119` anchors the whole day's curve on `oura_daily.readinessScore` →
`oura_daily.sleepScore` → flat 50. On the BLE-primary path both Cloud values are null, so the
morning anchor is a constant 50 regardless of how the night actually went — while our own
composite readiness (or `computeSleepScore`) is computed in the sibling route. Anchor on the
own composite (via `oura_daily_derived` or the shared input builder) with Cloud as fallback.

### 3.3 Other frozen-Cloud reads with no staleness marker — MEDIUM
All read `oura_daily` (frozen) and present as current: `temperature_deviation`
(`readiness-card.tsx:195`, chat context `:90`, health-insight `:74`), `vo2_max`/`vascular_age`
(heart-rate page `:112-125`), `stress_high`/`recovery_high` tiles (activity page `:30-38`),
`day_summary` (readiness page `:19-21`), `resilience_level` (chat + route `:363`),
`recommended_bedtime_*`/`sleep_time_status` (rest-day card `:46-48`), Cloud contributor JSONBs
(readiness/sleep/activity bars — see §1.3), and the activity blend preferring
`ouraToday.activityScore` when a row exists (`readiness-score/route.ts:225`). The ring-battery
"Not live" treatment (`oura-section.tsx:166-176`) is the reference pattern — the rest need
either a BLE-derived replacement (temp deviation is computable from `oura_daily_summary`
already), a "pre-re-key" marker, or removal.
Also: `RhrHrvSpo2Card`'s `metaRecent.find(...)` fallback (`rhr-hrv-spo2-card.tsx:24`) can
surface a weeks-old SpO₂ as "latest" with no date shown.

### 3.4 Tester battery readout reads a tag that ingest now drops — LOW
`0x61 debug_data` (carries `battery_pct`) is in `RAW_STORAGE_DROP_TAGS`
(`raw-storage.ts:17`) but `getOuraRawSampleSummary` still reads it for `latestBatteryPct`
(`adapter.ts:4523,4531-4535`) — the admin tester's battery figure goes permanently stale.
Either whitelist-keep the newest 0x61 per drain, or read battery from the plugin's live status
instead.

---

## 4. Same metric, different numbers/labels across cards — MEDIUM

- **"HRV" means three different things on adjacent surfaces:** `body_metrics.hrvMs` (daily
  rMSSD, RhrHrvSpo2 card + trends sparkline), `sleep_sessions.averageHrvMs` (overnight average,
  SleepCard + digest), and the 7d-vs-28d baseline card from `/api/readiness-score`. No label
  distinguishes them.
- **SleepCard "RHR" is actually `lowest_heart_rate`** (`sleep-card.tsx:72`) — reads lower than
  the Resting-HR tile (`body_metrics.restingHeartRate`) beside it.
- **Two sleep scores:** the Home chip / Sleep detail use `ouraToday.sleepScore ??
  computeSleepScore()` (route `:365`) while the SleepCard badge shows stored
  `sleep_sessions.sleep_score` — null on BLE nights, so the badge vanishes while the chip shows
  a number (or they disagree on Cloud-era days).
- **Two readiness numbers:** Home/detail show the blended `readinessDisplayScore`; `/overview`'s
  ReadinessCard leads with the raw Oura base. Same route, different emphasis, no explanation.

Pick one canonical source + label per metric (the One-Formula rule's display analogue) and
annotate aggregation windows ("overnight", "7-day") where they genuinely differ.

---

## 5. Confirmed healthy (no action)

- The readiness composite has **no dead contributors** anymore — recovery-index is live
  (calibrated curve), activity contributors are real (steps/calories/volume), baselines
  cold-start to neutral 50 by design with a `provisional` flag.
- `efficiency`, `onset_latency_sec`, `restless_periods` all feed `computeSleepScore` (not dead
  as hypothesised) — though on BLE nights `restless_periods` stores `model.awakenings` (0-10)
  against a penalty curve anchored at Oura's 10-50 scale (`sleep-score.ts:56`), so the penalty
  is effectively inert on the primary path — worth a re-anchor when P-C touches scoring.
- `sleep-performance-correlation` **is** wired (fetched in `health-content.tsx:328`) — an
  earlier draft of this review flagged it orphaned; verified live.
- HR pipeline: `getHrForWindow` is source-agnostic (Cloud/BLE/chest-strap merge cleanly), so
  Body Battery and charts pick up new sources automatically — the Polar H10 plan slots in
  without route changes.
- `mood_logs`/`day_checkins` are well-consumed by periodization + chat.
- Health Connect HTTP ingest is live-but-idle (fine); the native HC sync is dormant and
  superseded by BLE for ring-covered signals.
- Wear-time/non-wear is BLE-fresh and read end-to-end (the one `oura_daily` column with a live
  writer).

---

## 6. Priority map

| # | Finding | Severity | Effort | Queue status |
|---|---|---|---|---|
| 3.1 | Trends sparklines dead post-re-key → read `oura_daily_derived` | High | S | **new** |
| 3.2 | Body Battery anchor frozen → anchor on own composite | High | S | **new** |
| 2.1 | Illness radar → periodization signals, deload/rest gates, chat tool, digest, Home surfacing | High | M | **new** |
| 1.2 | Respiratory-rate baseline → 4th illness biomarker | High | M | **new** (radar's documented omission) |
| 2.2 | Stress → readiness modifier + chat/digest + intraday display + persist | High | M | partially P-E P2/P3 (persist); wiring/display **new** |
| 1.3 | Persist+read own sleep contributors (stop showing frozen Cloud bars) | Med | S | pairs with P-C |
| 2.4 | Temp deviation into periodization; sleep-score-based sleepTrend; SpO₂ into chat | Med | S | **new** |
| 3.3 | Frozen-Cloud display honesty sweep (marker / BLE replacement / removal) | Med | M | residual of the shipped health-tab overhaul |
| 4 | Metric source/label consolidation (HRV ×3, RHR mislabel, dual sleep score) | Med | S | **new** |
| 2.3 | Body Battery input tuning (observed HRmax, session awareness, constants) | Med | M | existing Nice-to-have + tuning doc |
| 2.5 | Measured energy → TDEE/goal rec | Med | gated | after P-D energy port |
| 3.4 | 0x61 battery drop-vs-reader inconsistency | Low | XS | **new** |
| 1.5 | MET baseline, rhr_avg, EDA 0x59 etc. — hold until their features land | Low | — | documented, no action |

## 7. Reconciliation with the existing queue

Not re-raised here because already queued: **P-C** (sleep staging/score completed-form —
covers §1.3's persist half), **P-D** (activity score, energy expenditure, OTS load — covers
§2.5's prerequisite and the activity-score calorie half), **P-E P2/P3** (stress persist,
cumulative stress, resilience, baseline reconcile — covers §1.4's persistence), **P-F P3**
(vascular age), **item 16** (cross-domain correlations), **Polar H10 Chunk B** (workout HRV),
the **apnea validation handoff** (owner-run night dump), and the standing **Body Battery
tuning** nice-to-have. The new findings above are queued as **Batch S** in
`docs/planned_upgrades.md` (this review is their source doc) — they graduate to
`docs/implementation-backlog.md` when a planning session writes their implementation plans.
