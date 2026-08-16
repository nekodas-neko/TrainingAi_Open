# Extended Metrics — Capture & Analysis (Oura device · workout timing · cross-domain)

**Status:** Design / feasibility only. **Not a plan, not implemented.** Written to be handed to a
reviewing agent to scope and turn into implementation plan(s). Theme: *capture the raw primitives,
derive the metrics later — it can't hurt to have too much data to analyse.*

**Date:** 2026-07-07

This merges three related explorations:
- **Part A — Oura ring device metrics** (wear time, battery/charging, BLE-only biometric signals)
- **Part B — Workout timing × intensity** (rest / set-time / TUT vs %1RM)
- **Part C — Other domains worth capturing or correlating**

Authoritative references to stay consistent with: the `oura-native-ble` skill,
`docs/oura-ble-operations.md`, and `docs/module-map.md` (reuse existing `lib/` formulas — 1RM,
ACWR, duration-model — never re-implement).

**Framing fact used throughout:** the Ring 5 is read **directly over BLE** (re-keyed to our own
auth key), so **the Oura Cloud API is frozen** — no new data. Everything new comes off the ring
over BLE or is derived server-side from raw samples / data we already store.

---

# Part A — Oura ring device metrics

## A1. Where the data lives today

Direct-BLE lands **raw tier-1 samples** in `oura_raw_samples` (`migrations/114`, `115`):
`ring_timestamp_ds` (deciseconds since the ring's own epoch — NOT UTC; resets on re-key / dead
battery), `tag`/`event_name`, `body_hex` (archival, re-decodable forever), `decoded` (JSONB,
nullable), `recorded_at`/`measured_at` (via `oura_ble_clock_anchors` ds↔UTC anchor). Because
`body_hex` is archival and a `redecode` path exists, **any metric that is a pure decode/aggregation
of already-captured tags can be back-filled from history with zero new on-ring collection.** This
is the load-bearing scoping fact: *server-side* metrics are cheap; *native* metrics (new on-ring
polling) are expensive and device-verification-only.

**Captured & rolled up:** HRV `0x5d` (5-min RMSSD), HR/IBI `0x80`/`0x60`, SpO₂ `0x6f`/`0x8b`,
temps `0x46`/`0x69`/`0x75`, MET `0x50`, motion `0x47`, sleep phases `0x4b`/`0x4e`/`0x5a`, bedtime
`0x76`.
**Read but thrown away:** the native service polls `reqBattery()` (`0c 00` → `{percent, charging}`)
on connect and **every 5 min** as keepalive, then discards it (notification/status only). **No
battery or charging column exists.** Battery also appears sparsely in history via `0x61` debug
frames (`battery_level_changed`, unvalidated `charging_time`).
**Decoded but unused:** wear state `0x53` (`wear_event`) / `0x45` (`state_change`) → `{state,text}`,
**unvalidated**, never rolled up or displayed.

## A2. Metric catalogue

For each: what → how → source → **native or server** → confidence → caveats.

- **Time on finger (wear time)** — hours/day worn + a worn/not-worn timeline. Derive server-side
  from sample density: the ring only emits IBI/temp/MET while worn and **skin temp falls to
  ambient** when off; worn = live biometrics AND temp in body range, off = gap AND temp ambient.
  Source: existing `oura_raw_samples`. **Server-only, no APK change, back-fillable.**
  Confidence med-high on *worn*, lower on exact edges. Caveat: "no samples" has four causes (§A4.1)
  — temperature is the disambiguator and must be in the rule.
- **Average charging time** — mean charge-session duration. Persist the battery poll as a time
  series `(t, percent, charging)`; a charge = a contiguous `charging==true` run. Prefer validating
  the ring's own `0x61 charging_time` frame first. Source: the 5-min `0c 00` poll (currently
  discarded) and/or `0x61` frames. **Native (small)** — the plugin already *reads* battery; it just
  needs to **POST** it → APK rebuild + on-device verify. Confidence med — limited by opportunistic
  sampling (§A4.2): charge often happens on a dock away from the phone → skews low/noisy.
- **Average battery drain %/time** — discharge rate while not charging (%/hr, est. runtime).
  From the same series over `charging==false` spans, rolling median. **Native (same dependency).**
  Confidence med-high once the series exists. Caveat: drain is **not one number** — it depends on
  enabled features (live-HR `CONNECTED_LIVE` drains far faster); segment by ring mode or it's
  meaningless. Voltage (`voltage_mv`) is a better fuel gauge than the coarse integer `percent`.
- **Battery-health / degradation** — is capacity declining over weeks? Oura never shows this.
  Rising drain-rate-per-mode or falling post-charge peak voltage = degradation. **Native (same
  series).** Low confidence early, grows with history; confounded by mode mix and epoch resets.
- **Daytime HRV trend** *(highest-value unique signal)* — continuous daytime 5-min RMSSD. Oura only
  shows *nighttime* HRV. Aggregate `0x5d`. **Server-only, back-fillable.** High confidence. Caveat:
  5-min RMSSD is a short, noisier window; motion contaminates it — filter/flag high-MET windows.
- **Intraday skin-temperature curve** — continuous temp (circadian, intraday fever onset) vs Oura's
  single nightly deviation. Aggregate `0x46/0x69/0x75`. **Server-only.** Caveat: skin ≠ core temp;
  tie to wear state so off-finger samples don't pollute it.
- **Intraday SpO₂** — per-sample vs Oura's nightly average. `0x6f/0x8b`. **Server-only.** Caveat:
  **Ring-5 SpO₂ coefficients are unknown** — treat as relative until derived/validated.
- **Data-capture completeness / "ring uptime"** — % of the day with samples; longest gap; last-sync
  age. Half health-metric, half pipeline-health gauge for you as operator. Any tag. **Server-only.**
  Caveat: low coverage is benign when worn-idle (radio asleep) — label "expected gap" vs "problem".

## A3. Native-vs-server split (the decision)

| Group | Metrics | APK rebuild? | Testable in sandbox? | Back-fill from history? |
|---|---|---|---|---|
| **Server-only** | wear time, daytime HRV, intraday temp, intraday SpO₂, completeness | ❌ No | ✅ Yes (stored `body_hex`) | ✅ via `redecode` |
| **Native** | charging time, drain rate, battery health | ✅ **Yes** (owner-only) | ❌ On-device only | ⚠️ Partial (`0x61` only) |

Server-only can be built/merged/verified in-session against the local DB. Native is gated on an
**owner APK rebuild** (`npx cap sync android && ./gradlew assembleDebug`) and only truly verifiable
on the S25. A sensible phasing is *server-only first, battery/native second* — a scoping call for
the reviewing agent.

## A4. Part-A caveats

1. **Wear inference is ambiguous.** A sample gap means: (1) not worn; (2) worn but radio-asleep
   (normal power-gating); (3) worn but not synced yet; (4) BLE link down. Only (1) is non-wear.
   IBI-absence alone conflates all four — the rule must combine it with **temp-at-ambient**, and a
   later history drain retroactively fills (2)/(3). Edges are ±minutes; validate against a known
   take-off day.
2. **Battery metrics = opportunistic sampling.** The poll fires only while phone+ring are
   connected. Charges are often unobserved/truncated → "average charging time" is a lower bound;
   drain spans can straddle disconnects (guard against a false cliff). The ring's self-reported
   `0x61 charging_time` (once validated) may beat our observed duration.
3. **The observer effect — measuring battery costs battery.** Persisting the *existing* 5-min poll
   adds ~zero ring drain. But deliberately holding a connection through a charge, or polling faster,
   adds real ring drain — degrading the very number you're measuring; and the foreground GATT
   connection is a real *phone*-battery cost (Samsung direct-connect, HIGH priority during drains).
   **Recommendation: do not add connections or increase poll frequency; persist what the 5-min
   keepalive already produces and accept the accuracy ceiling.**
4. **Clock-epoch resets break continuity.** `ring_timestamp_ds` resets on re-key / dead battery —
   and a dead battery is exactly what a battery-health metric wants to observe. Stitch series
   through `oura_ble_clock_anchors` (one anchor per epoch); never compute a rate/span across an
   epoch boundary.
5. **Unvalidated decoders** (`0x61 charging_time`, `0x53 wear_event`, `0x45 state_change`) — pin to
   a captured on-device vector before trusting; `redecode` lets this be done retroactively.
6. **Minimum sample size** — gate averages on N (≥3 charges / ≥1 week drain) with a "collecting…"
   state below it.
7. **Two battery sources coexist.** The Cloud chip (`components/oura-battery-chip.tsx`, from
   `/api/oura/token`) reads the now-**stale** official level and will disagree with the BLE value —
   replace or clearly label; don't leave both unlabeled.
8. **Admin/spike-gated, owner-only.** The whole `/api/oura-ble/*` pipeline is `requireAdmin` R&D —
   match that posture (admin gate, the `oura-ble-debug` screen), not public chrome.

## A5. Part-A storage options
(1) dedicated `oura_ring_battery` time-series `(user_id, measured_at, percent, voltage_mv,
charging)` — best fidelity, needs the native POST path; (2) ride `oura_raw_samples.decoded` via
`0x61` — zero-native but sparse/awkward; (3) server-derived (wear/HRV/temp/completeness) needs no
new storage — compute on read or a small daily-rollup table mirroring `aggregateOuraRawSamples`.

---

# Part B — Workout timing × intensity

## B1. TL;DR — we already capture the primitives
When a set is logged, `set_logs` stores actual rest, actual set duration, and the **actual %1RM**.
So "time taken vs pct" is **already backed by real columns** — the gap is the **analysis/output
layer**, plus a few genuinely-missing raw fields.

## B2. What we already capture (verified)
Per set (`set_logs`, `migrations/001` + `015_set_timing` + `077_rpe`): `weight_kg`, `reps`,
`rest_time_sec` (**actual rest**), `set_time_sec` (**actual set duration** — wall-clock lap),
`intensity_pct` (**actual %1RM** = `weight ÷ estimated1rm × 100`, computed server-side via
`computeIntensityPct`/`estimateOneRm`), `set_start_ms`/`set_end_ms`, `rpe`, `use_for_1rm`,
`set_number`. Per exercise (`exercise_logs`): `estimated_1rm`, `target_80`, `volume`, `avg_reps`,
`time_to_complete`, `inter_exercise_rest_sec`, `style_id/name`. Per session (`workout_sessions`):
`started_at`, `completed_at`, `session_rpe`, `warmup_ended_at`, `intensity_mode`. The store→payload→
server→**local SQLite mirror** path carries all of it (offline-first intact) — *not* discarded.
**1RM basis:** `intensity_pct` divides by the **session** estimate (that day's sets), not the
all-time PR (matters for trends — §B5.1).

## B3. What's genuinely missing
- **The analysis / adaptive output (the ask itself).** Nothing correlates timing with intensity.
  Build a **rest-vs-%1RM curve** (per user / per exercise): bin `intensity_pct`, plot median
  `rest_time_sec` per band — this *quantifies the user's own* relationship vs the fixed
  `style_sets.rest_sec`. Same for `set_time_sec`-vs-%1RM. Then the concrete *"allocate more time
  toward higher pct"* output: feed the measured rest-by-intensity back into
  `lib/workout/duration-model.ts` (today a static `setup + reps × tempo`) so rest/time-budget
  suggestions scale with real behaviour. **Keep it One-Formula** — extend the model, don't copy it.
- **Planned-vs-actual linkage.** `set_logs` stores only *actual* `intensity_pct`, not the *planned*
  pct/restSec of the `style_sets` row it came from; the only link is a **fragile positional**
  `set_number` join (styles are editable, sets can be added/removed). Snapshot `planned_pct` +
  `planned_rest_sec` onto `set_logs` at log time for robust adherence. Cheap, high-value.
- **True time-under-tension / rep tempo.** `set_time_sec` is wall-clock (includes setup/racking/
  breathing) — not eccentric/concentric tempo. Real TUT needs per-rep timestamps (rep-tap UI or
  detection) — the one item needing new *capture*, and the most expensive. Optional/later.
- **Set failure/grinder flag** — cheap boolean, distinct from RPE, useful for fatigue analysis.

## B4. Other timing/intensity metrics — derivable now vs new capture
**Derivable today, no schema change (bias here first):** avg rep cadence (`set_time_sec÷reps`);
RPE-vs-%1RM & RPE drift across sets (fatigue); work:rest ratio / session density; intensity
distribution (time/volume per %1RM band); fatigue index (rep drop-off at same load); rest adherence
(actual vs planned, positional); time-of-day performance; volume-load / tonnage-per-minute per
muscle; inter-exercise transition efficiency. **New capture:** the planned-pct snapshot, per-rep
tempo, and failure flag above — nothing else (don't add a column for what a query computes).

## B5. Part-B caveats
1. **`intensity_pct` is only as stable as its 1RM divisor** — the session estimate is derived from
   that day's sets (mildly circular) and drifts daily (a good day *deflates* every set's %1RM); can
   exceed 100% on AMRAP/PR. For **cross-session** analysis prefer dividing by a **stable rolling /
   all-time 1RM** (`personal_records.estimated_1rm`). Decide and document; don't mix.
2. **`set_time_sec` ≠ TUT** — wall-clock includes non-tension time; "set time vs pct" is noisy.
   Present as elapsed set time, don't over-read cadence. True TUT needs per-rep capture.
3. **Timer fidelity / missing data** — rest/set times exist only when the phases are run; skipped →
   nulls, and `sync-helpers` gates sending timing on *every* set having it. Handle nulls (drop,
   don't zero-fill — a zeroed rest looks like a superset). Report N per band.
4. **Optimistic local `intensity_pct` is null until sync** — inserted null locally, populated on
   pull-delta. Local-first analysis must tolerate null pct or recompute `weight ÷ local 1RM` on read
   (do **not** duplicate the pct formula into the local write — One-Formula).
5. **Positional planned-vs-actual is fragile** — trustworthy only if planned values are snapshotted
   at log time (§B3); else label approximate.
6. **Small-N per band** — a rest-vs-%1RM curve needs many sets per band and is **per-exercise**
   (bench rest ≠ deadlift). Gate the adaptive output on a minimum N; fall back to `style_sets.rest_sec`.
7. **Any new column carries the full offline-first tax** — local table + `queueMutation` payload +
   shared `logExerciseFromPayload` + `pushMutations` mirror + `pullDelta` mapping +
   `RECONCILE_COLUMNS`, one PR; keep the log payload lean / the save instant.
8. **Analysis, not a label** — surface derived signals with sample size + a plain explanation; never
   a lone authoritative number, and never let one silently gate an automatic programming change.

---

# Part C — Other domains worth capturing or correlating

**Context:** the app is already **data-rich** — it tracks nutrition (food/macros/water/supplements,
TDEE adaptation), sleep (stages, HRV, RHR, efficiency, **respiratory rate**, **VO2max**, **stress/
recovery minutes**, **BDI**, `day_summary`), subjective wellness (`day_checkins`: soreness +
`soreMuscles`, perceived recovery, motivation, hydration, tiredness, late-meal), session RPE
(Foster sRPE), body metrics (weight, bodyfat, steps, SpO₂), Oura tags/sessions/rest-mode, **weather**
(open-meteo) and **location**. So Part C is *not* "we track nothing" — it's three specific gaps.

## C1. Reclaim the now-frozen Cloud metrics via BLE derivation
Several rich columns were fed by the **Oura Cloud API, which is frozen** since the BLE re-key —
they still exist but **stop updating**. They can be recomputed from our own raw BLE samples:
- **Respiratory rate** (`sleep_sessions.respiratory_rate`) ← derive from IBI/motion during sleep.
- **Breathing Disturbance Index** (`oura_daily.breathing_disturbance_index`) ← from raw SpO₂ drops
  during sleep (`0x6f/0x8b`).
- **Own "stress / recovery minutes"** (`oura_daily.stress_high/recovery_high`) ← from **daytime HRV**
  (Part A) rather than Oura's proprietary phone metric.
- **VO₂max estimate** (`oura_daily.vo2_max`) ← from HR + HRR (§C2) + activity, our own estimator.
- **Skip cardiovascular age** — needs raw PPG waveform (server-gated, unreachable over BLE).
This is the cheapest high-value bucket: the columns, UI, and sync-shape already exist; only the
*data source* changes from Cloud to BLE-derived. Ties directly to Part A.

## C2. Genuinely-new captures (only possible now with direct ring HR)
- **Heart-rate recovery (HRR)** — how fast HR drops after a set / after the workout (e.g. 60-second
  recovery). A strong autonomic-fitness & fatigue marker **no consumer app gives you**, and newly
  possible because we can stream live HR over BLE around a set. Needs live-HR capture windows
  (native/BLE + a workout-time capture), and honest caveats: finger-PPG is motion-sensitive and
  weakest right after hard effort — treat as a trend, validate on-device.
- **Intra-workout HR / cardiovascular load** — HR during lifting, time-in-zones, a session "cardio
  cost" to sit alongside sRPE and tonnage. Same BLE-live-HR dependency.
- *(Skip grip/CNS tap-test unless a dynamometer exists — no sensor.)*

## C3. Cross-domain correlations over data we ALREADY have (no new capture — highest ROI)
The biggest untapped value: nothing joins the domains. All derivable from existing tables:
- **Energy balance / availability vs training load** — food `calories` vs `active_calories` + BMR;
  chronic deficit is the top hidden recovery killer. (TDEE-adaptation exists — extend it to flag
  under-fuelling *relative to training load / on hard days*.)
- **Sleep regularity index** — bedtime-time variance from `sleep_sessions` (a strong health
  predictor Oura buries) — cheap.
- **Meal / nutrient timing around workouts** — `food_logs` timestamps vs `workout_sessions.started_at`
  (pre/post window, protein distribution).
- **Soreness ↔ volume** — `day_checkins.restingSoreness`/`soreMuscles` vs per-muscle volume-load.
- **Readiness / HRV ↔ performance & rest** — do you take more rest / hit higher RPE at the same
  %1RM on low-HRV days? A readiness-adjusted-load signal (bridges Parts A & B).
- **Weather / heat & time-of-day ↔ performance** — weather is *already* tracked; correlate ambient
  temp / hour with session quality, rest, RPE.
- **Subjective-vs-objective gap** — perceived recovery/motivation (`day_checkins`) vs objective
  readiness/HRV; a persistent gap is itself a signal.
- **Bodyweight trend & rate-of-change** — smoothed slope from `body_metrics.weight` vs the goal.

## C4. Part-C caveats
- **Correlation ≠ causation & small N** — a single-user dataset is thin; present trends/associations
  with sample size and plain language, never causal claims or a lone score gating a change.
- **Frozen-Cloud reclaim depends on Part A derivations** being validated first (respiratory rate,
  BDI, stress) — don't ship a reclaimed metric until its BLE derivation is proven against a known
  value; the old Cloud values are the last-good baseline to sanity-check against.
- **HRR/intra-workout HR** inherit all the live-HR caveats (motion sensitivity, connection setup,
  ring worn+measuring) and are **on-device-only** to verify.
- Any new correlation surface still obeys the cache-group, offline-first, and instant-paint rules.

---

# Shared open questions for the reviewing agent

1. **Scope & phasing** — server-only-first (wear, HRV, temp, completeness, all Part-C correlations)
   vs native-first (battery)? These are largely independent and could be separate plans.
2. **Merge or split into plans** — Parts A/B/C are independent domains; likely ≥2 implementation
   plans (per the project's plan-then-build workflow), even though captured in one spec here.
3. **1RM basis** for `intensity_pct` in trend analysis — session estimate vs stable all-time PR.
4. **Battery accuracy ceiling** — accept opportunistic sampling, or add a hold-connection-through-
   charge mode despite its battery cost?
5. **Cloud battery chip** — replace with the BLE value or relabel both.
6. **Reclaim priority** — which frozen-Cloud metric first (respiratory rate / BDI / stress / VO₂max)?
7. **Live-HR capture** — is HRR / intra-workout HR wanted enough to build the live-HR capture path,
   or defer to after the battery/native work?
8. **Surfaces** — extend the admin `oura-ble-debug` screen, the health/analysis area, the post-workout
   summary, or a new owner-only device/insights card?

---

*Scope note: feasibility + caveats only — no migration numbers, endpoints, or DDL are fixed here.
That is the plan's job. Keep consistent with the `oura-native-ble` skill,
`docs/oura-ble-operations.md`, and `docs/module-map.md`.*
