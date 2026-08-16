# Oura Sub-plan F — Vascular Age (PWV) & Body-Composition Panel

**Date:** 2026-07-15 · **Status:** Planning (docs-only) · **Branch:** `feat/oura-cardio-bodycomp`
**Owner runtime:** S25 APK (canonical), BLE-only Ring 5 · **Program hub:** [`2026-07-15-oura-models-program-master.md`](2026-07-15-oura-models-program-master.md)

> Sub-plan **F** of the Oura on-device-model reimplementation program. Read the hub (§4 cross-cutting
> architecture, §6 phasing) and the **`oura-models` skill** first — model math is referenced here, not
> re-transcribed. This sub-plan covers two *unrelated-in-effort* features that share a chapter only
> because both are "cardio/metabolic frozen `oura_daily` fields we could revive":
>
> - **Body composition** (fat/lean mass + BMR + trend) — **pure arithmetic on data we already store.
>   Phase 1, ship now.**
> - **Vascular age / PWV** — the *model* is ready, but its *input* (raw PPG morphology at a known
>   rate) is **unproven on our BLE path**. **Phase 3, gated on an on-device capture spike. Do NOT
>   commit the port until the spike passes.**

---

## 1. Goal

1. **Body-composition panel (P1):** turn the `weight_kg` + `body_fat_pct` we already store into the
   three *actionable* body-comp metrics — **fat mass, fat-free (lean) mass, BMR** — plus weighted
   **trend lines** for each, and surface them in a simple Health view. No new hardware, no model, no
   bioimpedance. Persist in completed form (`oura_daily_derived.body_comp`).

2. **Vascular age / PWV (P3, spike-gated):** the `cva_1_3_0` NN + the portable `cva_calibrator_1_3_0`
   + the CVA→PWV cubic are all extracted and ready. The **only** blocker is proving our BLE pipeline
   actually captures a usable raw-PPG waveform (full pulse **morphology** at a known, continuous
   ~50 Hz). This sub-plan specifies an **explicit capture-validation spike** that must pass *before*
   any model port is written, and — only if it passes — the port + calibrator + persistence.

The two are deliberately decoupled: **body-comp ships independently of the vascular-age outcome.** If
the PPG spike fails, F still delivers the body-comp panel and closes the vascular-age line item as
"not feasible on current capture" without stranding work.

---

## 2. Current state (cited)

### 2.1 Vascular age / PWV — frozen, and the input is unproven

- **Persisted but dead.** `oura_daily.vascularAge` (`integer`, years) and
  `oura_daily.pulseWaveVelocity` (`doublePrecision`, m/s) exist (`lib/data/postgres/schema.ts:656-658`,
  added by `migrations/089_oura_resilience_cardio.sql`) but were **only ever filled by the now-dead
  Oura Cloud sync** (`GET /v2/usercollection/daily_cardiovascular_age`). Since the 2026-07-07 BLE
  re-key the Cloud gets no new data, so these columns are **frozen** — no BLE-derived path exists.
- **NONE derived on BLE.** Grep confirms `vascular_age`/`pulse_wave_velocity` appear only in the Cloud
  client (`lib/oura/{types,client}.ts`), the sync/webhook routes, the schema, and docs — never in
  `lib/health/*` or the BLE rollup.

### 2.2 Raw-PPG capture — the CRITICAL UNCERTAINTY (call this out loudly)

The CVA models need full pulse **morphology** — mean pulse shape, VPG (1st derivative), APG (2nd
derivative), SNR, area-under — over **1500 samples = 30 s @ exactly 50 Hz** (`cardiovascular-hr.md`
§1: validator rejects `sampling_rates != 50` with error 113, and `dim1 != 1500`). **IBI/beat
intervals alone are provably insufficient.** Our current capture does not clearly provide this:

- **Tag `0x81` (`cva_raw_ppg_data`)** *is* decoded — `decodeCvaRawPpg` (`lib/oura-ble/decode.ts:284`)
  reconstructs a waveform as the **cumulative sum of signed-int8 deltas**, one sample per body byte,
  with each event's chunk restarting the accumulator at 0 (`decode.ts:287-292`). **But three things
  are unknown / broken:**
  1. **Sample RATE is not encoded or pinned anywhere.** The ~50 Hz figure in the codebase applies to
     the `0x33`/accel stream, **not** to `0x81`. Nothing proves `0x81` is 50 Hz, or even uniform.
  2. **Chunks are per-event with no cross-event stitching.** The accumulator resets each event
     (`acc = 0`), so we have short relative fragments, not a continuous 30 s trace. No stitching logic
     exists.
  3. **`0x81` is NOT captured or consumed by anything today.** Grep for `ppg_samples` finds only
     `decode.ts` — the decoded field is produced and immediately discarded. It is not persisted into
     any consumable series, not rolled up, not read.
- **The dedicated continuous raw-PPG tags `0x64` (`raw_ppg_event`) / `0x68` (`raw_ppg_data`) have NO
  decoder at all** — they are named in `EVENT_NAMES` (`decode.ts:569-570`) but fall through the
  `decodeBody` switch `default: return null` (`decode.ts:553-554`). Whether the ring even *emits*
  them on our frozen firmware, and at what rate, is unknown.

**Consequence:** we cannot assume CVA is reproducible. The model is ready; the *signal* is not proven.
This is a **capture problem, not a model problem** (hub §3), and it gets a spike, not a commitment.

### 2.3 Body composition — inputs held, panel not derived

- We store `body_metrics.weightKg` and `body_metrics.bodyFatPct` (`schema.ts:205-206`), populated from
  manual logs / Health Connect.
- **No body-comp view exists.** No fat-mass, lean-mass, or BMR-trend surface. The *only* BMR calc in
  the app is nutrition-goal sizing: `goal-recommendation.ts:53-54` already computes
  **`bmr = 370 + 21.6 * leanMassKg`** (the Cunningham equation) from `bodyFatPct` — i.e. the exact
  formula this panel needs already lives in the repo. Per **One-Formula-One-Place**, the panel must
  **share** that helper, not add a second copy.
- `atlas_2_1_0`'s bioimpedance tags `0x87`/`0x88` are decoded (`decode.ts:549-552`,
  `decodeAtlasMetadata`/`decodeAtlasRawBioz`) but unused — and the Ring 5 lacks BIA electrodes, so the
  full `atlas` model (muscle/bone/water split) is **out of scope** (hub §8). We derive only what
  weight + body-fat% supports.

---

## 3. Inputs captured

| Input | Tag / source | Captured? | Notes |
|---|---|---|---|
| **Raw PPG waveform, 30 s @ 50 Hz, full morphology** | BLE `0x81` (+ maybe `0x64`/`0x68`) | ⚠️ **UNCERTAIN** | `0x81` decoded but rate-unpinned, per-event fragments, **unconsumed**; `0x64`/`0x68` **undecoded**, emission unknown. **The whole vascular-age feature hangs on this.** |
| Demographics (gender, age, height, ring size) | `users` profile / ring config | ✅ | CVA needs `[gender∈{-1,0,1}, ring_size∈0-4, age∈15-120, height (model units 4-15)]` — sourced from profile |
| CVA daily history + timestamps + hw-change ts | derived (once CVA runs) | ✅ (self-produced) | Calibrator inputs; built from `oura_daily_derived` history once the port exists |
| **Body weight** | `body_metrics.weightKg` | ✅ | Manual / Health Connect |
| **Body-fat %** | `body_metrics.bodyFatPct` | ✅ | Manual / Health Connect — **reliability caveat, see §10** |

---

## 4. Model reference (see skill; do not re-transcribe)

All math lives in `.agents/skills/oura-models/references/{cardiovascular-hr.md, metabolic-body-repro.md}`
and the SHA-pinned constants bundle (`C:\Temp\oura_bundle_lite\oura_model_constants\`, vendored per
sub-plan B). Load numbers from the vendored constant — never hardcode (hub §4.2).

### 4.1 Vascular age — `cva_1_3_0` (`cardiovascular-hr.md` §1)

- **Architecture:** `MainAlgo` = Validator → Preprocessor (`cva_pp`) → Predictor (`cva_pd`, a 3-conv
  CNN, **317,522 params**, ~1.38 MB) → Postprocessor (`cva_po`). *Smaller and simpler* than
  `cva_2_1_0` (a 1.8 M-param transformer that also predicts SBP/DBP) — **port `1_3_0`, not `2_1_0`.**
- **Inputs:** `forward(ppg_segments[N,1500], sampling_rates(==50), timestamps, demographics[N,4])`.
- **Preprocessing** turns each 1500-sample segment into a 250-sample **mean pulse** + **VPG** + **APG**
  (derivatives), plus a 7-feature vector `[snr, area_under, pulse_acceptance_rate, mean_corr,
  mean_dist, timestamp, sampling_rate]`. This is where morphology (not IBI) is required.
- **Age-calibration (constants VISIBLE, `cva_1_3_0.constants.json`):**
  `calibration_x1 = 0.59989976`, `calibration_constant = 19.93490906`, `calibration_factor = 0.442`.
  `calibrated = chrono_age + (predicted_age − chrono_age·0.59989976 − 19.9349)`, then shrink toward
  chrono age by `min(|va_ca|, √variance)·0.442·sign`.
- **CVA→PWV sex cubic (VISIBLE, `cva_1_3_0.constants.json`):** `pwv = p0·cva + p1·cva² + p2·cva³ + p3`.
  - `male_nonlinear_params   = [0.161263637, -0.00202955818, 1.44036404e-05, 3.0]`
  - `female_nonlinear_params = [0.16937677, -0.00277361094, 2.15952243e-05, 3.0]`
  - **Same cubic family** is shared across `cva_1_3_0`, `cva_2_1_0` (as an inverse LUT), and the
    calibrator — one constant source, one helper.
- **Clamps / quality (VISIBLE):** `cva ∈ [14,100]`, `pwv ∈ [5,20]`; quality tier from variance:
  `<105 → 1 (best)`, `<145 → 2`, else `3`.

### 4.2 Vascular-age calibrator — `cva_calibrator_1_3_0` (fully portable, `cardiovascular-hr.md` §3)

- **0 params / 0 tensors** — pure rules + the cubic. `cva_calibrator_1_3_0.constants.json` (584 bytes,
  fully vendored): `male_nonlinear_params` / `female_nonlinear_params` (identical to §4.1),
  `days_required_offset = 14`, `max_historical_lookup = 5184000` s (60 d), `male = 1.0`,
  `female = -1.0`. Window constant `2592000` s = 30 d and freeze logic are in the reference.
- **What it does:** a **30-day rolling-median offset tracker** (min 14 days) that re-baselines on a
  hardware/ring change and freezes the offset once `≥ days_required_offset` nonzero offsets accrue.
  Output `calibrated_cva = daily_cva + offset`. Re-implementable in TS with zero weights.

### 4.3 Body composition — arithmetic + `atlas_trendline_1_0_0` (`metabolic-body-repro.md`)

- **The panel is pure arithmetic** (from `atlas`'s Postprocessor formulas, `metabolic-body-repro.md`
  §atlas_2_1_0):
  - `fat_mass  = weight_kg · bodyFat%`
  - `ffm (lean) = weight_kg · (1 − bodyFat%)`
  - `bmr = ffm · 21.6 + 370` — the **Cunningham** equation, **the exact one `atlas`'s postprocessor
    uses** *and* the one already in `goal-recommendation.ts:53-54`.
  - (`pbf` bounds for plausibility, if we sanity-check: `atlas_2_1_0.constants.json`
    `pbf_lower_male = 3.0`, `pbf_upper_male = 50.0`.)
- **Trend lines — `atlas_trendline_1_0_0` (0 params, portable, `metabolic-body-repro.md`
  §atlas_trendline):** weighted least-squares fit to a metric time series.
  - `sigma = clamp(|y|·cv, 1e-6)`, `w_conf = conf^1.5`, **`weights = conf^1.5 / sigma²`**.
  - Per-metric CV (`metabolic-body-repro.md`): **FFM = 0.017, FM = 0.036, PBF = 0.036** (BMR has no
    Oura CV — derive its trend from the FFM trend, since BMR is affine in FFM, OR use `default = 0.02`).
  - `slope = ss_xy/ss_xx`, `slope_se = √(1/ss_xx)`, CI = slope ± 1.282·slope_se,
    `z = |slope|/slope_se`, **`trend_significance = 1 − exp(−z²/2)`**.
  - Guards: `min_points = 3`; min span by window (weekly 3 d / monthly 10 d / yearly 120 d); returns
    all-NaN + `valid_flag = 0` when invalid. Windows `0=weekly,1=monthly,2=yearly`; metrics `0-4`
    (0 FFM, 2 FM, 3 PBF). Errors 501/502 for bad window/metric.
- **NOT derivable (bioimpedance-only, out of scope):** skeletal-muscle mass, bone mineral content,
  total-body-water split. Less actionable for training than lean-mass + BMR (hub §8).

---

## 5. Design decisions

### 5.1 Body composition — Phase 1, arithmetic, ship now

- **Derive, don't store raw twice.** `fat_mass`/`ffm`/`bmr` are pure functions of
  `(weightKg, bodyFatPct)`. Compute them in a single shared helper and persist the finished values in
  completed form (§6) so history is analysis-ready (hub §4.1) — but they remain re-derivable from the
  two source columns via redecode/backfill.
- **One BMR formula, one place.** Extract the Cunningham `bmr = ffm·21.6 + 370` (currently inline at
  `goal-recommendation.ts:53-54`) into a shared `lib/health/body-composition.ts` and have
  goal-recommendation import it. Two copies of the same formula is a bug by definition (CLAUDE.md
  "One Formula, One Place"). The helper exports `deriveBodyComp({ weightKg, bodyFatPct })` →
  `{ fatMassKg, ffmKg, bmrKcal }` (null-safe: returns `null` when either input is missing).
- **Trend via the portable `atlas_trendline` port.** Add `lib/health/weighted-trendline.ts`
  implementing the WLS regressor (§4.3) with the per-metric CVs vendored from the constants bundle.
  This is a **generic reusable utility** — the hub notes `atlas_trendline` is a candidate for *any* of
  our metric trend lines, so build it as a domain-agnostic `weightedTrend(days[], values[],
  confidences[], { cv })` and register it in `docs/module-map.md`. Body-comp is its first consumer.
- **Confidence input:** manual/HC body-fat% has no per-sample confidence; pass `conf = 1.0` for
  logged days (the WLS then reduces to weighting by `1/sigma²`). Leave a hook for a real confidence if
  a future body-fat source provides one.
- **View:** a compact body-comp card/section in the existing Health surface (§7.2) — lean/fat mass
  numbers + a small trend sparkline per metric, with the trend direction paired with a label/arrow
  (never colour-only, CLAUDE.md visual rules). Reuse `components/ui/sparkline.tsx`.

### 5.2 Vascular age — SPIKE FIRST, port gated on the spike passing

**The port is NOT scheduled until the capture spike passes.** Sequence is strict:

1. **Spike (§8 P3-A) — on-device capture validation.** Answer three questions with device evidence:
   - **(a)** Does the ring emit `0x81` during a relevant window, and at what *effective* rate and
     continuity? (Instrument the native ingest to log `0x81` inter-event timing + body lengths over a
     worn+resting session; the CVA preprocessor needs uniform ~50 Hz over 30 s.)
   - **(b)** Are `0x64`/`0x68` (continuous raw PPG) emitted at all on our frozen firmware, and if so do
     they carry the true continuous trace we'd need to decode? (They currently `default → null`.)
   - **(c)** Does a captured segment, decoded and stitched, reproduce **plausible pulse morphology** —
     i.e. can we detect feet/peaks, segment beats, and get a clean mean pulse + VPG/APG with a sane
     SNR? Validate against a known-good reference (e.g. compare derived HR from the PPG peaks against
     the ring's own IBI/HR for the same window).
   - **Deliverable:** a written spike finding (a Known-Issues row / short doc) with a **go / no-go**
     verdict and, if go, the **pinned sample rate + stitching rule** as a captured test vector.
2. **Culling coordination (do this as part of the spike decision, not after).** If we pursue CVA, raw
   PPG (`0x81` and/or `0x64`/`0x68`) must be **captured and persisted** — this is **large data volume**
   (continuous waveform samples). That directly conflicts with sub-plan A's data-culling goal (the DB
   is already blowing up). **Flag to sub-plan A:** raw PPG must be added to the retention design as a
   *bounded, purpose-scoped* capture (e.g. capture only during an on-demand CVA measurement window,
   retain `body_hex` per the archival rule, prune decoded PPG series aggressively). Do **not** turn on
   unbounded all-day PPG storage.
3. **Port (§8 P3-B) — only if the spike verdict is GO.** Then: port `cva_1_3_0` (server-side NN
   inference — TorchScript→ONNX or equivalent; no PyTorch in the WebView, hub §4.4) + the portable
   `cva_calibrator_1_3_0` (pure TS), persist to `oura_daily_derived.vascular_age`/`pwv`.
- **Inference infra decision (deferred to the port, flagged as a risk §10):** `cva_1_3_0` is a
  318K-param CNN. Running it server-side in the Node/Next rollup means an ONNX runtime (e.g.
  `onnxruntime-node`) plus a PPG preprocessing port (foot detection, per-beat resample, VPG/APG). This
  is a **new infra dependency** — sized only if the spike passes.
- **Explicitly:** if the spike is NO-GO, close the vascular-age line item with a note ("raw-PPG capture
  insufficient on frozen firmware — CVA not reproducible"), keep `oura_daily.vascularAge`/`pwv` frozen,
  and ship only the body-comp panel.

---

## 6. Storage — completed form

Both features write finished values into the program's single durable derived table
**`oura_daily_derived`** (defined by sub-plan A, hub §4.1) — one row per user per local day. This
sub-plan **adds columns/JSONB**, it does not create the table.

### 6.1 Body composition (P1)

- **`oura_daily_derived.body_comp` (JSONB):** `{ fat_mass_kg, ffm_kg, bmr_kcal, weight_kg,
  body_fat_pct, source }` — snapshot of the two source inputs + the three derived values on that day.
  Storing the inputs alongside makes the row self-describing for redecode/audit.
- **Trend outputs** are computed on demand from the history of `body_comp` rows (they are cross-day
  aggregates, like the sanctioned server-computed aggregates in CLAUDE.md) — **not** persisted per-day.
  If we want them persisted for analysis, add `oura_daily_derived.body_comp_trend` (JSONB:
  `{ ffm: {slope, ci, significance}, fm: {...}, bmr: {...} }`) written by the rollup; default is
  compute-on-read for the view.
- **Provenance:** `source = 'ble-derived'` is wrong here (body-comp comes from manual/HC weight, not
  BLE) — use `source = 'derived'` with a `model_version` tag for the Cunningham/trendline constants
  (hub §4.6).

### 6.2 Vascular age (P3, only if spike passes)

- **`oura_daily_derived.vascular_age` (int)** + **`pulse_wave_velocity` (double)** + a
  **`vascular_age_meta` (JSONB):** `{ raw_cva, calibrated_cva, offset, is_offset_frozen, variance,
  quality_tier, model_version: 'cva_1_3_0', calibrator_version: 'v1.3.0', source: 'ble-derived' }`.
- The legacy Cloud columns on `oura_daily` (`schema.ts:657-658`) stay as the historical Cloud record;
  the BLE-derived values live in `oura_daily_derived` so analysis can tell the two pipelines apart
  (hub §4.6). Do not overwrite the frozen Cloud values.

---

## 7. Plumbing

### 7.1 Rollup (server-side, `aggregateOuraRawSamples` in `lib/data/postgres/adapter.ts`)

- **Body comp (P1):** in the daily rollup, read that day's `body_metrics.{weightKg, bodyFatPct}`,
  call `deriveBodyComp(...)`, write `oura_daily_derived.body_comp`. Idempotent — re-running the rollup
  for a day overwrites the same row (hub §4.3). Skip the write when both inputs are null (no phantom
  zero rows).
- **Vascular age (P3):** in the rollup, gather that day's validated PPG segments → run the ported
  preprocessor + NN → raw CVA → feed the calibrator with the user's CVA history (from prior
  `oura_daily_derived` rows) + hw-change timestamp → write `vascular_age`/`pwv`/`vascular_age_meta`.
  Runs only when ≥1 valid 30 s segment exists for the day.

### 7.2 Read sites & view

- **Body-comp view:** add a body-composition section to the Health surface. Options: a new section in
  `app/health/health-sections.tsx` (kept under the ~800-line ceiling — extract into a
  `components/health/body-composition-card.tsx` child, CLAUDE.md component-size rule), or a detail
  page under `app/health/body/page.tsx` mirroring the existing `app/health/{sleep,readiness,activity,
  heart-rate}/page.tsx` structure. Prefer a card in the existing Health page first; a dedicated page
  only if the trend charts warrant it.
- **Read pattern:** the view reads the completed-form values via the standard `cachedFetch` +
  `readCacheSync` instant-paint pattern (CLAUDE.md). Body-comp is a **cross-day aggregate** (like
  `weights-summary`), so it is a sanctioned server-computed read (the offline-first local-first rule
  exempts cross-session aggregates) — it does not need a local-store write path.
- **Vascular-age display (P3):** surface calibrated vascular age + PWV + quality tier on the
  heart-rate / readiness detail surface where the frozen Cloud value used to show. Show the quality
  tier as a label, not colour alone.

### 7.3 Cache groups

- Body-comp is derived from body-metric writes. The existing **`invalidateBodyMetricWrite()`**
  (`lib/cache-groups.ts:190-198`) is the write group for weight/body-fat logs — **add the body-comp
  cache key(s) to that group** in the same PR (never hand-roll a key list at the call site, CLAUDE.md
  cache rule). Register any new `readCacheSync` key there and in `lib/cache-ttl.ts` with one canonical
  TTL.
- Vascular age is derived in the Oura rollup — its cache key joins **`invalidateOuraSync()`**
  (`cache-groups.ts:143-147`, alongside `readiness-score`).

### 7.4 Redecode discipline

- Body-comp needs no `body_hex` (it is not a BLE decode) — but it *is* re-derivable from the two
  `body_metrics` columns, so a backfill pass simply re-runs `deriveBodyComp` over historical
  `body_metrics` rows to populate `oura_daily_derived.body_comp` for past days.
- Vascular age (P3) obeys the archival rule: raw PPG `body_hex` stays immutable; a decoder/model
  improvement back-fills by **re-decoding stored hex + re-running inference**, never by re-draining the
  ring (CLAUDE.md Oura rules, hub §4.3). **This is exactly why the culling design (§5.2.2) must retain
  the PPG `body_hex` even while pruning the bulky decoded series.**

---

## 8. Phased task list

### Phase 1 — Body-composition panel (ship now, no blockers)

1. **`lib/health/body-composition.ts`** — `deriveBodyComp({ weightKg, bodyFatPct })` →
   `{ fatMassKg, ffmKg, bmrKcal } | null`. Cunningham `bmr = ffm·21.6 + 370`. Unit-tested.
2. **Refactor `goal-recommendation.ts:53-54`** to import the shared BMR helper (kill the duplicate
   formula). Verify nutrition-goal output is byte-identical before/after.
3. **`lib/health/weighted-trendline.ts`** — port `atlas_trendline_1_0_0` WLS (§4.3) as a generic
   `weightedTrend(days, values, confidences, { cv })`. Vendor CVs (FFM 0.017 / FM 0.036 / PBF 0.036)
   from the constants bundle (sub-plan B loader). Unit-tested against the guard/edge cases.
4. **Rollup write** (`aggregateOuraRawSamples`): compute + persist `oura_daily_derived.body_comp`;
   idempotent; skip when inputs null. (Depends on sub-plan A having created `oura_daily_derived`.)
5. **Backfill** pass over historical `body_metrics` → `oura_daily_derived.body_comp`.
6. **View:** `components/health/body-composition-card.tsx` (lean/fat mass + BMR + per-metric trend
   sparkline w/ label). Wire into `health-sections.tsx`. Instant-paint cache-seeded.
7. **Cache:** add body-comp key to `invalidateBodyMetricWrite()`; TTL in `lib/cache-ttl.ts`.
8. **Module map + changelog + version bump** (minor — new feature).

### Phase 3 — Vascular age (gated; do NOT start P3-B until P3-A passes)

**P3-A — Capture-validation spike (Kotlin/native + analysis, on-device):**
9. Instrument native ingest to log `0x81` inter-event timing, body lengths, and continuity over a
   worn+resting session; determine effective rate and whether 30 s of uniform ~50 Hz is achievable.
10. Probe `0x64`/`0x68` emission on frozen firmware; if emitted, capture raw bodies for analysis
    (no decoder committed yet).
11. Decode + stitch a captured segment; validate pulse morphology (foot/peak detection, mean pulse,
    VPG/APG, SNR); cross-check PPG-derived HR against ring IBI/HR for the same window.
12. **Write the spike finding + GO/NO-GO verdict.** If GO: pin the sample rate + stitching rule as a
    test vector; coordinate the **bounded** PPG retention design with sub-plan A (§5.2.2). If NO-GO:
    close the line item, keep Cloud columns frozen, done.

**P3-B — Port (ONLY if P3-A = GO):**
13. Vendor `cva_1_3_0` weights + constants (sub-plan B); decide inference infra (ONNX runtime,
    server-side).
14. Port the `cva_pp` PPG preprocessor (segment→mean pulse + VPG/APG + 7 features) in TS/native.
15. Run `cva_1_3_0` NN server-side → raw CVA + variance; apply age calibration (constants §4.1);
    CVA→PWV cubic (shared helper §4.1/4.2).
16. Port `cva_calibrator_1_3_0` (pure TS, 0 params) — 30-day rolling-median offset + freeze +
    hw-change re-baseline.
17. Persist `oura_daily_derived.vascular_age`/`pwv`/`vascular_age_meta`; rollup + redecode path;
    join `invalidateOuraSync()`.
18. Display on heart-rate/readiness surface; device-verify; changelog + version bump.

---

## 9. Testing

### Body composition (P1)
- **Unit tests** for `deriveBodyComp`: known `(weight, bf%)` → expected fat/lean/BMR; null-input →
  null; boundary body-fat% (0, 1). Confirm BMR matches `goal-recommendation.ts` output post-refactor
  (regression guard against the shared-formula change).
- **Unit tests** for `weightedTrend`: monotone-up / flat / noisy series → expected slope sign +
  `trend_significance`; `< min_points` and `< min_span` → `valid_flag = 0`; `ss_xx == 0` vertical
  case; per-metric CV wiring.
- **Boundary/tz test** for the rollup day-bucketing (23:59 / 00:01 user-local, CLAUDE.md date rules).
- **`pnpm dev`** exercise: log a weight + body-fat%, confirm the panel updates and the trend renders.

### Vascular age (P3)
- **Spike gate first** — no port tests until §8 P3-A passes.
- **Validation-vector requirement (mandatory for the port):** every ported preprocessor/decoder step
  and the NN inference is pinned to a **captured PPG test vector** from a real ring session (CLAUDE.md
  Oura decoder discipline / hub §4.5). The port is not "done" until a captured 30 s segment reproduces
  a plausible CVA within the model's clamps `[14,100]` and PWV `[5,20]`, and the calibrator's
  rolling-median/freeze behaviour is unit-tested against a synthetic history.
- **Device gate:** all BLE capture behaviour is only real on the S25 APK (Kotlin changes need an owner
  APK rebuild `npx cap sync android && ./gradlew assembleDebug`, CLAUDE.md). The spike and any capture
  change are device-verified or carry an explicit Known-Issues row marking them not-yet-device-verified.

---

## 10. Risks

1. **Raw-PPG capture volume vs DB culling (highest).** Persisting continuous PPG is large-volume and
   directly fights sub-plan A's culling goal. Mitigation: bounded, on-demand-window capture only;
   retain `body_hex` per archival rule but prune decoded PPG series aggressively; **do not** enable
   unbounded all-day PPG. Must be co-designed with sub-plan A *before* P3-B — not bolted on after.
2. **Capture spike may fail (feature-killing).** `0x81` may be non-uniform / non-50 Hz / un-stitchable,
   and `0x64`/`0x68` may not be emitted on frozen firmware. If so, CVA is **not reproducible** and the
   feature is closed — this is an accepted outcome, not a bug. Do not re-onboard the official Oura app
   to "fix" it (forbidden — firmware/protocol risk, CLAUDE.md).
3. **NN inference infra.** `cva_1_3_0` (318K params) needs a server-side ONNX runtime + a faithful
   PPG-preprocessing port (foot detection, per-beat resample, VPG/APG). New dependency + real risk of
   preprocessing drift vs Oura's `cva_pp`. Sized only post-spike; pin every step to a test vector.
4. **Body-fat% data-source reliability.** The panel is only as good as its input; consumer BIA scales
   and manual estimates are noisy, so fat/lean/BMR inherit that error. Mitigation: the `atlas_trendline`
   weighting + `trend_significance` already down-weight noise and flag low-significance trends; surface
   the significance/CI, don't present a single-day number as precise. Sanity-clamp PBF to
   `[pbf_lower_male=3, pbf_upper_male=50]` and flag out-of-range logs.
5. **Completed-form dependency.** Both features write `oura_daily_derived`, created by sub-plan A —
   P1-step 4 and all of P3 are blocked until A lands. Body-comp helpers/tests (P1 steps 1-3) and the
   view have no such dependency and can proceed in parallel.

---

## 11. Backlog entry

Add to `docs/implementation-backlog.md` (docs-only planning PR; implementer works it later per the
backlog protocol). Priority: **after** enablers (A, B) and the high-value sleep/recovery batches (C,
E) — F is the capture-gated tail (hub §7). The body-comp half is cheap and could be pulled forward as
a standalone item if desired.

```
### feat/oura-cardio-bodycomp — Vascular age (spike-gated) + body-composition panel
Plan: docs/superpowers/plans/2026-07-15-oura-cardio-and-body-composition.md
Depends on: feat/oura-data-architecture-culling (oura_daily_derived), feat/oura-model-constants-ingestion
Phase 1 (ship independently): body-composition panel — deriveBodyComp (fat/lean/BMR, shared
  Cunningham helper w/ goal-recommendation), weightedTrend (atlas_trendline port), oura_daily_derived
  .body_comp, Health body-comp card. Pure arithmetic, no capture work.
Phase 3 (GATED): vascular-age PPG-capture spike (0x81 rate/continuity, 0x64/0x68 emission, morphology
  validation) → GO/NO-GO. Only if GO: port cva_1_3_0 (server-side ONNX) + cva_calibrator_1_3_0 (portable)
  + CVA→PWV cubic; persist oura_daily_derived.vascular_age/pwv. Coordinate bounded PPG retention with
  sub-plan A BEFORE porting. If NO-GO: close line item, Cloud columns stay frozen.
Device gate: Kotlin capture changes need APK rebuild; BLE behaviour device-verified on S25.
```
