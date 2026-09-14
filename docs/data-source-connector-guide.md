# Data Source Connector Guide

_Reference doc, 2026-09-14 (PS-40, extended same day). Answers a concrete engineering question that
[`device-agnostic-source-architecture.md`](device-agnostic-source-architecture.md) deliberately left
open: **given the goal of not being locked to one ring, what does a new data source actually plug
into — what shape does it send, which table does it land in, which calculation reads it, and what
happens when it can't supply something?** That doc states the tiers and the invariants; this one is
the contract a new integration is checked against. No code in this repo implements a formal
`DataSourceConnector` interface yet — §10 proposes one and files the implementation as a backlog
entry rather than building it inline, per `CLAUDE.md`'s backlog-driven-implementation rule.
Everything else here (the tables, the formula inputs, the normalize-layer pattern, the backfill
mechanisms) is described from the current code, not aspirationally — every claim below was checked
against the source, not summarized from memory.

---

## 0. The model, in two layers

Every source — including Oura — is reduced to exactly the same thing before any score ever sees it:

```
Layer 1                              Layer 2
─────────────────────────────────    ───────────────────────────
Device data, COMPUTED                Our formulas
(sleep stages, HR series,            (Sleep Score, Readiness,
 temperature, steps, HRV, ...)       Activity Score, stress, ...)
```

**For most devices, Layer 1 arrives for free.** Health Connect, a scale, a strap — the vendor's own
firmware or app already computed the finished value, and we just receive it.

**Oura is not a special case in the design — it's the one source where WE have to produce Layer 1
ourselves**, because the ring hands us something rawer than a finished value. We run our own
models (a sleep-staging model, a step-counting model, and so on — see §5.6) specifically to
manufacture the exact same Layer-1 shape another device would have handed over directly. Once
that's done, Oura is indistinguishable from any other source: everything from Layer 2 downward reads
Layer 1 only, never asks which device or which computation produced it.

**This is what makes the app survive losing the ring**: Layer 2 has exactly one dependency (Layer
1), and Layer 1 already has more than one supplier. §13 lists precisely what Layer 1 needs to
consist of for every pillar to work at full strength, and which parts of it only Oura supplies
today — not because they're conceptually tied to the ring, but because nothing else has been wired
to fill that shape yet.

The rest of this doc is the detail behind that picture: §1-§2 cover *how* data physically arrives,
§3 is the exact shape of each Layer-1 value, §4 is what each Layer-2 formula consumes, §5 is how
Oura's own computing step works and where it currently produces a shape nothing downstream reads
(§5.5/§5.6), §6-§9 cover the mechanics (provenance, isolation, ingestion, backfill), and §13 is the
full requirements list this section promises.

---

## 1. The three things every source answers

Before wiring a new ring, strap, or platform aggregator (Health Connect, Apple HealthKit, a Garmin
export, whatever comes next), answer three questions. Get these wrong and the source either can't be
added without a schema change, or it silently corrupts scoring for every other source sharing the
same table.

1. **What tier is it?** Raw-capable (emits per-beat/per-sample signal, we derive the metric) or
   computed (the vendor already derived sleep stages / steps / HRV). See §2 of
   `device-agnostic-source-architecture.md` — this decides whether you're writing a new decoder or a
   new mapping layer.
2. **Does it share scoring tables, or is it isolated?** If its values should ever influence
   readiness/sleep/activity scores, it writes into the same generic tables every other source uses,
   ranked by trust (§5). If it's unvalidated (a new ring you don't yet trust, a device in "learning
   mode"), it gets **its own table family**, kept structurally out of the ranked set — see §6.
3. **What shape is each data type in?** A scalar-per-day is not a time series is not an event list.
   §3 is the canonical shape for every data type the app currently consumes. Get the shape wrong and
   either the data doesn't fit the column, or it fits but silently loses information (e.g. storing a
   mean bpm where a formula in §4 needed the full series).

---

## 2. Transport categories (how data physically arrives)

| Category | What it is | Today | Auth |
|---|---|---|---|
| **Direct BLE (raw)** | App/native code talks GATT straight to the device; we own the decoder | Oura Ring 5 (`lib/oura-ble/`), Renpho scale (`lib/scale-ble/`), Polar H10 (`lib/polar-ble/`) | Session (or admin, for the raw Oura ingest route) |
| **Direct BLE (learning mode)** | Same transport, but writes are isolated until trusted | Colmi R09 (`lib/colmi*` — see `docs/superpowers/plans/2026-08-26-alternative-ring-colmi-testing.md`) | Session |
| **Platform aggregator (computed)** | OS-level health store that already merged whatever the user wears | Android Health Connect (`lib/health-connect-sync.ts`) | Session, via `/api/sync-health` |
| **Platform aggregator, secret-gated** | Same idea, driven by an external automation (Tasker) rather than the in-app client | Health Connect via `/api/health-connect/ingest` | Shared secret, no session — **not currently multi-tenant** (single hardcoded `WEBHOOK_USER_ID`) |
| **Manual entry** | User types a number | Body metadata form | Session |
| **Cloud API (retired)** | Vendor's OAuth'd REST API, webhook-pushed or polled | Oura Cloud — **removed 2026-08-13, never re-add** (§ "Oura Ring — the Cloud integration is GONE" in `CLAUDE.md`) | — |

**Apple HealthKit is not implemented and there is no iOS build.** The canonical runtime is the S25
Ultra APK (`CLAUDE.md` "Canonical Runtime"). If iOS ever becomes a target, HealthKit is a **computed
source** in exactly the shape Health Connect is — same generic tables, same normalize-layer job
described in §5.5, needing its own `HealthSource` value (e.g. `'healthkit'`) and its own record-type
mapping (HealthKit's `HKQuantityTypeIdentifier` set, not Health Connect's `Record` classes). No
native Kotlin work carries over.

---

## 3. Data type catalog — the canonical shape of each metric

For each kind of data a source might supply: what shape does the app expect, and where does it
land? "Shape" means: scalar-per-day, time-series list, interval/session object, or event list.
Getting the shape right on the first integration avoids a rewrite later — the app already learned
this lesson twice (Health Connect's sleep-stage array almost got flattened to four totals before
someone read `RecordConverter.kt`, and `saveSleepSession`'s optional `source` param shipped a real
provenance bug before it was made required).

### 3a. Heart rate — **time-series list**, never a scalar

```ts
{ timestamp: string /* ISO */, bpm: number, source: 'ble' | 'chest_strap' }[]
```

- **Table:** `oura_heartrate` — one row per `(userId, timestamp)`, shared by every HR source (ring
  rollup writes `source: 'ble'`, Polar strap writes `source: 'chest_strap'` via `POST /api/hr-ingest`).
- **Not per-field ranked merge** — HR/RR have no `source_map`. Read-time bucket precedence instead:
  `getHrForWindow` prefers `chest_strap` over `ble` per bucket, because the strap is electrical
  ground truth and the ring is optical (see `docs/multi-device-comparison.md`).
- **⚠ This is the one table where a real generic source (Health Connect) exists but is not
  normalized in.** Health Connect's `HeartRateSeries` record type carries the same intraday shape
  as this table — but today it is read only to backfill per-session avg/max HR onto individual
  `activity_logs` (`enrichActivityLogs`, `lib/health-connect-sync.ts:186-230`). It is **never
  written into `oura_heartrate`**. §4 shows the concrete cost of this gap: Activity Score's
  zone-minutes/move-hours contributors go missing for a Health-Connect-only user even though the
  data exists — it just never reaches the table those contributors read.
  `docs/implementation-backlog.md` files this as **PS-41**.
- **Derived from HR, not stored separately:** `daily_zone_minutes` (per-day time-in-zone) is a
  server-computed cache over `oura_heartrate`.
- **This bpm value is the one metric in §5.6's classification that's a trivial, universally
  portable conversion** (`60000 / ibi_ms`) rather than a model — see §5.6. **HRV is a different
  story and does NOT live in this table**: it's the ring's own computed `rmssd_ms`, quality-selected
  (not recomputed) into `body_metrics.hrvMs` — see §5.6 before assuming HRV is "ours" the way steps
  or sleep stages are.
- **RR intervals (beat-to-beat), if the device exposes them:** separate list, separate table.
  ```ts
  { at: string /* ISO */, rrMs: number, source?: string /* defaults 'chest_strap' */ }[]
  ```
  → `rr_intervals`, pruned at 90 days.

### 3b. Sleep — **one session object with a stage-interval array**, reduced two ways

```ts
{
  sleepStart: string, sleepEnd: string,
  deepSleepHours: number, remSleepHours: number, lightSleepHours: number,
  awakeHours: number, timeInBedHours: number,
  sleepPhase5Min?: string, // regex ^[1-4]+$, max 288 chars; 1=deep 2=light 3=REM 4=awake
  efficiency?: number, onsetLatencySec?: number, averageHrvMs?: number,
  avgHeartRate?: number, lowestHeartRate?: number, respiratoryRate?: number, sleepScore?: number,
}
```

- **Table:** `sleep_sessions`, unique on `(userId, sleepStart)`.
- **Write path:** `repo.saveSleepSession(userId, session, source: HealthSource)` — `source` is a
  **required** parameter; an optional one defaults to rank 0 and can permanently out-write a better
  source under first-write-wins semantics (this was a real shipped bug once, §4c of the architecture
  doc).
- **The interval → 5-min-bucket reduction is a reusable primitive.** Health Connect's raw
  stage-interval array (`{startTime, endTime, stage}[]`, confirmed at `RecordConverter.kt:81-90`) is
  reduced with `intervalsToPhase5Min()` (`lib/health-connect-sync.ts`) — the **same function** the
  Oura BLE rollup's stage output goes through. A new source with interval boundaries should reduce
  through this same function.
- **If your source only has stage *durations*, no interval boundaries**, omit `sleepPhase5Min`
  entirely rather than fabricating a flat/guessed hypnogram.

### 3c. Daily body/activity scalars — **one row per user per day, sparse columns**

```ts
{
  date: string, // YYYY-MM-DD, user-local
  weightKg?, bodyFatPct?, steps?, distanceKm?, restingHeartRate?, hrvMs?,
  spo2Pct?, activeCalories?, waterMl?,
  skeletalMusclePct?, fatFreeMassKg?, subcutaneousFatPct?, visceralFatIndex?,
  bodyWaterPct?, muscleMassKg?, boneMassKg?, proteinPct?, bmrKcal?, metabolicAge?,
}
```

- **Table:** `body_metrics`, unique on `(userId, date)`, `sourceMap: jsonb` stamps per-field
  provenance so a scale can win `weightKg` while a ring wins `steps` on the same day.
- **Write path:** `repo.upsertBodyMetrics(userId, metrics[], source: HealthSource)`.
- **Cumulative-field gotcha:** a source reporting "today's" steps/calories mid-day is reporting a
  **partial day** — never compare a same-day cumulative read against a completed day's total.

### 3d. Activity sessions (walks/runs/workouts the source detected) — **event list**

```ts
{
  title?: string, activityType: string, // free text; server falls back to 'other' if unmapped
  start: string, end: string, durationMin?: number,
  distanceKm?: number, calories?: number, avgHr?: number, maxHr?: number,
}[]
```

- Maps through a source-specific `exerciseType → activityType` table (`EXERCISE_TYPE_TO_ACTIVITY_TYPE`
  in `lib/health-connect-sync.ts` is the reference) — every new source needs its own, vendors don't
  share a vocabulary. Unmapped types fall through to `'other'` server-side.
- **Table:** `activity_logs`, via `saveActivityLog`.
- Distinct from **workout sessions** — structured strength-training data the app's own UI writes. A
  source cannot populate a workout, only enrich one after the fact.

### 3e. Raw signal (only for a raw-capable/BLE source with its own decoder)

```ts
{ frames: [{ hex: string /* ≤2048 chars */ }], /* ...max 2000 per batch */ }
```

- **Table:** an archival raw table specific to that device family — never the generic tables
  directly. `oura_raw_samples` (`bodyHex` archival, `decoded` jsonb, deduped on
  `(userId, ringTimestampDs, tag, bodyHex)`) is the reference shape: archival hex is never mutated or
  pruned; a decoder bugfix redecodes from stored hex rather than needing a re-drain.
- A background rollup turns the raw archive into the generic shapes in §3a–3d. This rollup **is**
  the normalize layer — see §5.

---

## 4. Calculation inputs — what each score actually needs, and what it does without it

This is the part that decides whether "the app works for any wearable" is true in practice, not just
architecturally. Each row below was traced to its actual source function — not inferred from the
table it reads.

| Calculation | Source | Hard-required input | Soft inputs (degrade/renormalize if absent) | Hard-Oura-only inputs (**no fallback exists**) |
|---|---|---|---|---|
| **Readiness composite** | `packages/shared/src/health/readiness-composite.ts` + `lib/health/readiness-payload.ts` | none — always returns a score | RHR z-score, HRV-balance z-score, sleep-duration z-score, previous-night Sleep Score, previous/today Activity Score, recovery-index hours, daily check-in energy — each missing input → neutral 50, not a blank card | **temperature contributor** (0.10 weight) — generic path passes `tempZ: null` always, never approximated; **recovery-index** needs a continuous overnight HR series (ring/strap only) |
| **Sleep score** | `packages/shared/src/health/sleep-score.ts` | `durationHours` (returns `null` without it) | restfulness, efficiency, REM, deep, latency, schedule, HRV, HR — each conditionally added and the blend **renormalizes over whichever weights are present** | none — genuinely source-agnostic by design; REM/deep/HRV/HR are all suppliable by Health Connect's own record types |
| **Chronic/daytime stress, resilience, daytime-HRV** | `packages/shared/src/health/chronic-stress-assembly.ts`, `lib/health/stress-resilience.ts`, `packages/shared/src/health/daytime-hrv-model.ts` | — | — | **all of it.** 30-sec hypnogram array, per-5-min HRV/HR, raw skin-temp samples, raw MET events — every input reads `getOuraDaytimeSignals` → raw BLE frame tables (`readRawFrames`, tags `0x46`/`0x69`/`0x50`). Returns empty arrays with no ring anchor; **zero fallback branches anywhere in the call chain** |
| **Body Battery** | `packages/shared/src/health/body-battery-walk.ts` + `app/api/body-battery/route.ts` | — | — | continuous intraday HR (`oura_heartrate`), resolved HR-max, and the stress model above — **no generic/fallback branch in the route** |
| **Illness radar** | `packages/shared/src/health/illness-radar.ts` | — | temperature (0.40), breathing (0.25), RHR (0.20), HRV-balance (0.15) — each optional, formula renormalizes over what's present | **not a formula limitation — a wiring gap.** The formula itself degrades gracefully, but its only caller (`readiness-payload.ts`) computes it *only if* an `oura_daily_summary` row exists — a Health-Connect-only user gets no illness computation at all, degraded or otherwise. Filed as PS-42 below |
| **Training load / ACWR** | `packages/shared/src/ai-periodization/acwr.ts` (`computeVolumeAcwr`) | logged workout volume (`AcwrSession[]`, user-entered tonnage) | — | none — entirely source-agnostic, doesn't touch wearable data at all |
| **OTS training stress score** | `packages/shared/src/health/training-stress.ts` + `lib/oura-models/inference/ots.ts` | — | — | full-day 1-min MET grid from raw ring events, persisted non-provisional `oura_daily_derived.readiness_score`, derived VO2max — **hard Oura-only, distinct from ACWR above** which is the source-agnostic training-load signal |
| **Activity Score** | `packages/shared/src/health/activity-score.ts` | — | steps (18%) and activeCalories (15%) from `body_metrics` — **Health-Connect-writable**; strength-frequency/volume (45% combined) from logged workouts — source-agnostic | **zoneMinutes (10%) and moveHours (12%)** — both derived from intraday `oura_heartrate`, which (see §3a) Health Connect's equivalent series never reaches. Renormalizes rather than hard-failing, but a HC-only user is missing 22% of the formula's weight for a fixable reason, not a fundamental one |

**Reading this table:** `device-agnostic-source-architecture.md` §5's claim — that sleep staging
beyond totals, daytime-HRV→stress→resilience, readiness's temperature term, illness detection,
training-stress score, and Body Battery "do not survive" a device switch — is **confirmed accurate**
for everything except illness radar and Activity Score's HR contributors, which are gaps a
normalize-layer fix could close (§5.5, §5.6). Readiness and Sleep Score already have real,
shipped degraded-input code paths — not aspirational, verified in `readiness-payload.ts` lines
494–541 (`// Generic-source fallback (Q-43)`) and the conditional-weight blend in `sleep-score.ts`.

---

## 5. The normalize layer — decode, normalize, then write

**The rule this section makes explicit:** a raw-capable device's decoder must never write
device-specific values directly into a scoring table. It decodes bytes into typed intermediate
values, **normalizes them into the exact same shapes §3 defines for every other source**, and only
then writes — through the same repository methods a computed source (Health Connect) calls. This is
already how the Oura pipeline works; this section names the three stages so a new raw-capable source
copies the pattern instead of reinventing it, and so the one place it's currently violated (§5.5) is
visible as a defect rather than an accepted design.

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  Raw bytes  │ --> │   Decode     │ --> │    Normalize     │ --> │  Write (§6, §7)   │
│ (device-    │     │ (device-     │     │ (device-agnostic │     │  same repository  │
│  specific)  │     │  specific)   │     │  §3 shapes)       │     │  method every      │
│             │     │              │     │                   │     │  source calls      │
└─────────────┘     └──────────────┘     └───────────────────┘     └────────────────────┘
```

### 5.1 Decode — device-specific, isolated

Turns raw bytes into typed values in whatever units/encoding the protocol uses. For Oura BLE:
`lib/oura-ble/decode.ts` (`historyEventFromHex`), byte layouts from the reverse-engineered
`open_oura` protocol. Decoders are **infallible by design** — an unknown tag returns `decoded: null`
and the raw row still stores (never throw, never drop), so a later decoder fix can backfill by
redecoding stored `body_hex` rather than needing a re-drain from the device. This stage is the only
place device-specific byte knowledge lives; nothing downstream of it should need to know the
protocol.

### 5.2 Normalize — the step that makes every source interchangeable

Turns decoded device-specific values into the §3 shapes. For Oura BLE this is the rollup
(`lib/oura-ble/rollup/run.ts` → `runOuraRollup`) — it reads decoded raw events over a window and
produces exactly the shapes §3a–3d describe: sleep sessions (bedtime-window detection + neural
sleep-staging, reduced to `sleepPhase5Min` the same way Health Connect's interval array is),
`body_metrics` upserts (steps/RHR/HRV/SpO2/temp), 5-min-binned HR into `oura_heartrate`. **This is
the concrete answer to "the ring needs its own decoding, but ideally it normalizes to what other
devices produce":** it already does, for every field it emits. A new raw-capable device's
normalize step should target the *same* generic shapes, not invent parallel ones — if a future ring
emits sleep stages, it produces a `sleepPhase5Min` string through `intervalsToPhase5Min()` or an
equivalent reduction, never a device-specific stage encoding that only its own reader understands.

**What "portable" means in code:** the rollup's computation (`run.ts`) is injected an I/O port
(`lib/oura-ble/rollup/io.ts` → `RollupIO`, 22 methods) rather than calling the database directly —
so the same normalize logic can run against a Postgres implementation (`createPostgresRollupIO`) or,
per the in-progress on-device work, a local-SQLite one, without duplicating the computation. A new
raw-capable source's normalize step doesn't need this level of portability from day one, but the
principle — normalize logic separate from storage — is worth copying: it's what stops "a device
rollup" from becoming a second, drifting implementation of the same formula (the exact failure mode
`CLAUDE.md`'s "One Formula, One Place" rule exists to prevent).

### 5.3 Write — identical regardless of source

Every normalize step, whatever device produced its inputs, ends at the same repository methods:
`upsertBodyMetrics`, `saveSleepSession`, `upsertOuraHeartrate`, `insertRrIntervals`, `saveActivityLog`
— each requiring a typed `source: HealthSource` and going through the ranked merge (§6). A computed
source (Health Connect) skips §5.1/§5.2 entirely — the vendor already normalized on its own device —
and its mapping layer (`lib/health-connect-sync.ts`) goes straight from platform record types to §3
shapes, landing at the exact same write step. **This is why the tier split (raw vs. computed, §2) is
the right generalization axis and not "Oura vs. everything else":** both tiers converge on identical
code from the normalize step onward.

### 5.4 What this buys: a formula never needs to know which device produced its input

Every calculation in §4 reads generic tables, never a device-specific one. `computeReadinessComposite`
doesn't know whether `body_metrics.hrv_ms` came from a ring's rollup or Health Connect's
`HeartRateVariabilityRmssd` — by the time it's a row in the table, the provenance is a `source`
column, not a code branch the formula has to handle. This is the entire value of doing §5.1–5.3 as
three separate stages instead of one device-specific pipeline per source.

### 5.5 Where the pattern is currently violated — the HR-series gap

Named already in §3a and §4's Activity Score row: Health Connect's `HeartRateSeries` record type
carries intraday HR — the same shape `oura_heartrate` stores — but `lib/health-connect-sync.ts`
never runs it through a normalize step that writes into that table. It's read, but only consumed
inline to enrich `activity_logs.avgHr`/`maxHr` for individual sessions
(`enrichActivityLogs`), then discarded. The data needed to compute Activity Score's zone-minutes and
move-hours contributors for a Health-Connect-only user already arrives in the sync payload; it's
just never normalized into the table those contributors read. This is the concrete, fixable instance
of the general rule this section states — filed as **PS-41** in `docs/implementation-backlog.md`.

### 5.6 Ring-computed vs. our-own-model — the precise portability classification, per metric

§5.2 says the rollup normalizes decoded values into the §3 shapes. It doesn't say who did the
*computation* those values represent — and that distinction is the actual answer to "can we
calculate stress from the decoded-data layer, and what's automatic versus what do we calculate
ourselves." Verified against the decode/model code directly (`lib/oura-ble/decode.ts`,
`lib/oura-models/`, `lib/health/night-vitals.ts`), not assumed:

| Metric | Verdict | Evidence |
|---|---|---|
| **Steps** | **We compute it, entirely.** Not a ring-transmitted count at all. | `decodeRealSteps` (tags `0x7e`/`0x7f`) decodes per-window accelerometer feature vectors — the code comment states explicitly these are inputs to the ring's *own* internal model, not a count, and warns against reading them as one. The live pipeline runs a gait-autocorrelation heuristic over raw `0x33` accelerometer frames (`lib/oura-ble/gait-step-count.ts`) and a vendored ONNX model (`lib/oura-models/steps-motion-decoder.ts` → `lib/oura-models/inference/step-counter.ts`, `step_counter_1_3_0_core.onnx`) over the same raw motion — both ours, both running on raw signal |
| **Sleep stages (hypnogram)** | **Mostly we compute it.** Decode support for a ring-transmitted array exists but the Ring 5 doesn't use it in practice. | `decodeSleepPhases` (tags `0x4b`/`0x4e`/`0x5a`) is a pure decode of a ring-transmitted stage array — but `lib/oura-ble/rollup/run.ts:494`'s own comment: "the Ring 5 emits no phase events." The live path is our own SleepNet ONNX inference (`lib/oura-models/inference/sleepnet.ts`) on raw motion/HR/temp epochs, or a heuristic stager when even that's unavailable |
| **Instantaneous HR (bpm)** | **Trivial conversion, universally portable.** | The ring transmits inter-beat-interval (`ibi_ms`, its own PPG beat-detection firmware output); `hr_bpm = 60000/ibi_ms` is our arithmetic, not a model. Any device exposing beat intervals feeds this identically — this is the one case where "our computation" carries none of the Oura-specific porting risk the other rows do |
| **HRV (rMSSD)** | **Ring-computed — we select, not recompute.** | `decodeHrv` (tag `0x5d`) decodes the ring's own paired `(bpm, rmssd_ms)` samples, one per 5 min, computed on-ring. `night-vitals.ts`'s own header rule: HRV is "a quality-gated MEDIAN of the ring's own `0x5d` rmssd_ms, never a recompute from IBI" — deliberately preserved as the ring's figure, not ours |
| **Skin temperature** | **Ring-computed sample, we aggregate.** | `decodeTemperatures` (tags `0x46`/`0x69`/`0x75`) is a pure centi-°C decode of the ring's own sensor reading; nightly temperature is our median/windowing over those already-computed samples |
| **Respiratory rate** | **We compute it**, from the ring's IBI. | `breathingFromIbi` per 5-min epoch, night figure = median of per-epoch breaths/min — our algorithm on the ring's beat-interval output |
| **RHR** | **We compute it** — an aggregation over our own bpm-from-IBI values. | `nightlyHeartRate()`: lowest 5-min *bin average*, MET-gated, never the raw per-beat minimum. No RHR scalar is ever transmitted by the ring |
| **SpO2** | **We compute it, and it's uncalibrated.** | The Ring 5 "never emits the firmware-calibrated `spo2_event` over BLE" (confirmed overnight, per code comment) — only raw R ratio-of-ratios + perfusion index (`0x8b`), run through a borrowed-coefficient quadratic explicitly flagged `calibrated: false`. Worth knowing this is already weak for Oura, not a regression a new device would introduce |
| **Chronic/daytime stress, resilience, daytime-HRV** | **Our own models — but fed by ring-computed intermediates, not raw PPG/accelerometer.** | `cumulative-stress.ts`, `stress-resilience.ts`, `daytime-hrv-model.ts` all consume the ring's own per-epoch outputs: `0x5d` HRV samples, `0x46`/`0x69` temp samples, `0x50` MET bins — never raw waveform data directly. The daytime-HRV replacement is explicit about this: `HRV_TAG = 0x5d`, `TEMP_TAGS = [0x46, 0x69]`, fit by OLS against the ring's own paired samples |
| **Body Battery** | **Entirely our own model.** No BLE tag carries a Body Battery figure — inputs are our own derived HR/RHR values (above) plus the stress model |
| **Training Stress Score (OTS)** | **Our own algorithm, on a ring-computed input.** | `runTrainingStressScore` is our port of a vendored formula, run over the ring's own `0x50` MET series (`decodeActivityInfo` — ring firmware computes MET per bin) plus RHR/readiness/profile |

**What this means for "if we ever moved to a new device, would it stay similar":** the practical
porting bar for most of §4's "hard Oura-only" row is **not** "does the new device expose raw
PPG/accelerometer waveforms" — it's **"does the new device expose the same per-epoch
intermediates the Oura ring already reduces to for us"**: a 5-minute HRV/bpm pair, periodic
skin-temp samples, per-bin MET/activity. Several consumer rings and straps already do this over
their own BLE services or SDKs. Steps and sleep staging are the exception — those are genuinely
"raw signal → our own model" today (accelerometer → gait/ONNX step model; motion+HR+temp →
SleepNet), which is the **opposite** of most computed-tier sources (Health Connect gives finished
steps and a finished stage array directly, no model needed on our side at all — see §2's tier
split). That asymmetry is worth being explicit about rather than assuming "decoded from Oura" and
"received from Health Connect" sit at the same level of abstraction — they don't, for those two
metrics specifically, even though both ultimately land in the same §3 shape.

### 5.7 Could we compute a ring-computed value ourselves instead, for future consistency?

Worth asking of every "ring-computed, we decode" row in §5.6: is there a lower-level raw signal we
could run our own computation on instead of trusting the ring's figure — which would mean any
device exposing that lower-level signal (not specifically Oura's exact per-epoch computation) could
feed the same pipeline? Checked against the actual code rather than assumed:

- **HRV (rMSSD) — yes, and the computation already exists, just isn't wired to the scoring
  pipeline.** `packages/shared/src/health/rmssd.ts` → `rmssdFromRr(rrMs: number[])` is a standard
  rMSSD implementation (successive-difference formula, Kubios-style artifact filtering, 30-beat
  minimum) — its own header comment calls it "the ONLY RR→rMSSD implementation in the app," and
  distinguishes itself from the ring's `0x5d` events explicitly. It's real, tested, and already
  running on live device data — but only for a workout's rest-window HRV
  (`packages/shared/src/workout/compute-workout-hr.ts`, fed by the Polar H10's raw beat intervals
  via `rr_intervals`). Every other HRV consumer — nightly HRV (`night-vitals.ts`), Readiness,
  chronic stress, resilience — reads the ring's own precomputed `0x5d rmssd_ms` exclusively;
  `rr_intervals` (and `rmssdFromRr`) never reach any of them. **The practical consequence: the
  Polar strap is already streaming the raw ingredient this would need into the app today.** If worn
  overnight, nightly HRV could in principle be computed from it right now, with no new device
  integration — only a pipeline change. Filed as **PS-44** in `docs/implementation-backlog.md`.
- **MET/activity intensity — no independent computation exists; would be genuinely new work.**
  The app's calorie/energy estimate is HR-regression-first (`estWorkoutKcalFromHr`, a published
  formula) with a MET-based fallback — but that MET table is Oura's own vendored data
  (`lib/oura-models/__fixtures__/constants/energy-expenditure-features.json`), not something the
  app derives from raw accelerometer. Unlike HRV, there's no shelved implementation to wire up;
  building a raw-accelerometer MET estimator would be new work shaped like the step-counter model
  (§5.6) — its own model, its own calibration — not a rewiring of an existing one.
- **Skin temperature — nothing to gain.** A temperature sample already *is* the rawest available
  reading; there's no lower layer left to compute it from ourselves.
- **SpO2 — already fully our own computation**, and already flagged in §5.6 as uncalibrated. The
  open problem here is calibration quality (needs a real pulse-oximeter reference to fit against),
  not "should we compute it ourselves" — we already do.
- **Respiratory rate — already fully our own computation**, from the ring's raw IBI stream, and
  already portable to any device exposing beat intervals — nothing further to change.

**The one thing worth stating plainly before actually wiring `rmssdFromRr` into the live scoring
path:** the app currently trusts the ring's own value on purpose, per `night-vitals.ts`'s own
comment — not an oversight. Before replacing it, validate the recomputed figure against the ring's
own `0x5d` values over real history, the same way the app already did once for a different metric
(`daytime-hrv-model.ts`'s own header calls its approach "observe-never-feed" — built from scratch,
checked against Oura's output, only then trusted). Swapping a live health-score input without that
check is exactly the kind of change `CLAUDE.md`'s Standing Agents rules reserve for Tuning-style
validation and owner sign-off, not a silent code change.

---

## 6. Provenance — the ranked per-field merge

Every write into a shared scoring table (`body_metrics`, `sleep_sessions`, `oura_heartrate`) carries
a `source: HealthSource`. Sources are ranked (`packages/shared/src/health/source-rank.ts`):

```
manual (5) > scale_ble (4) > oura_ble (3) > oura_cloud (2) > health_connect (1) > unknown (0)
```

`mergeSet(table, cols, source)` (`lib/data/health-source.ts`) applies this **per field, per date** —
not per row, not per source globally. A higher-or-equal rank overwrites a field; a lower rank may
only fill a `NULL`. This is why `body_metrics.source_map` exists: on a single day, the scale can win
`weightKg` while the ring wins `steps`, independently.

**Adding a new source's rank is a one-line change** in `source-rank.ts` (it's shared/driver-free
specifically so a device port can reuse it). Two decisions to make before you do:

1. **Where does it sit relative to existing sources?** A computed/aggregator source (Health
   Connect-tier) generally ranks below a raw-capable device we decode ourselves, and always below
   manual entry. A second raw-capable ring of unknown accuracy does **not** automatically rank above
   the trusted one — rank reflects trust, not recency.
2. **Does it even belong in the ranked set?** If not — see §7.

---

## 7. Isolation — when a new source should NOT share scoring tables

A low rank is not isolation. **The per-field merge governs writes; every scoring read is
source-blind** — nothing that reads `oura_heartrate`/`body_metrics`/`sleep_sessions` filters by
source, so a row that lands in those tables is scored, however it's ranked (this was the concrete
finding that shaped the Colmi integration — see
`docs/superpowers/plans/2026-08-26-alternative-ring-colmi-testing.md`).

If a source is unvalidated — a device you don't yet trust to influence readiness/sleep/activity
scores — give it its own table family instead, kept **structurally** out of the ranked set:

- Its own tables (`colmi_readings`, `colmi_raw_frames`, `colmi_sleep_segments` are the reference
  shape — mirror §3's shapes but in isolated tables).
- Its `HealthSource`-like tag deliberately **excluded from the `HealthSource` union type**, so a
  writer that tries to pass it into a scoring-table write is a **compile error**, not a runtime check
  that can be forgotten.
- No sync/outbox/local-store domain — it doesn't participate in offline-first until it graduates.
- A CI check pinning the isolation (`scripts/check-learning-mode-isolation.js`) so a future PR can't
  accidentally wire a shared write in.

Promote it to a ranked source only after a real comparison against a trusted reference (the strap is
the only ground-truth HR source in this app — see `docs/multi-device-comparison.md`).

---

## 8. The ingestion route pattern

Every current ingest route (`/api/oura-ble/samples`, `/api/scale-ble/samples`, `/api/hr-ingest`,
`/api/colmi/samples`, `/api/sync-health`, `/api/health-connect/ingest`) follows the same shape:

1. **Auth** — session cookie, or a shared secret with no session — never a `userId` from the body.
2. **Rate limit** — per user/IP, matching a sibling route.
3. **Byte cap** — `readJsonLimited`, not an unbounded body read.
4. **Zod schema, batch-shaped, per-item validated** — the schema describes the batch envelope, but
   out-of-range values are dropped **per item**, never failing the whole batch (the poison-pill
   rule).
5. **Write through the repository's typed method**, never raw SQL — this is what makes §6's
   provenance merge unconditional.
6. **Cache invalidation is client-side today**, not server-side in the route — the client fires
   `invalidateBiometrics()`/`invalidateActivityWrites()` (`lib/cache-groups.ts`) after a successful
   sync. A server-side route reached with no client in the loop (the shared-secret Tasker path)
   relies on TTL expiry instead — acceptable for that specific low-frequency path, not a pattern to
   copy for anything the user expects to see update immediately.

---

## 9. Backfill — what exists today, and what a new source needs

The user-facing question this answers: **if a source can't stream live data, can it fill in history
instead?** Today, partially, and each mechanism is narrower than it looks.

### 9.1 What exists

| Source | Backfill exists? | Window | Trigger |
|---|---|---|---|
| **Health Connect (in-app client sync)** | Yes, but capped and heuristic | 30 days "cold" / 7 days "hot" (`SYNC_DAYS_COLD`/`SYNC_DAYS_HOT`, `lib/health-connect-sync.ts`) | **Client-local `localStorage` first-run heuristic** (`ta_hc_last_sync` absent → cold). Not an account-level flag — reinstalling the app or clearing site data re-triggers a 30-day cold pull, still capped at 30. **No UI or parameter exists to request more than 30 days** even for a genuinely new connection with more history available |
| **Health Connect (Tasker-driven ingest route)** | Yes, per-call | Rolling **7-day tolerance** (`INGEST_PAST_TOLERANCE_DAYS`, `packages/shared/src/validation/ingest-clock.ts`) — a `date` field clamps to `[today-7, today]` | External caller (Tasker) posts one call per historical day it wants filled, each within the 7-day window |
| **Oura ring's own BLE buffer** | **No — strictly forward-only.** | — | The ring's on-device history buffer is finite and the app's sync cursor only advances forward. If the cursor advances past data the app hasn't yet read, **that data is gone** — there is no re-request mechanism against the ring itself. Historical gaps can only be *repaired from data already ingested* (redecode from stored `body_hex`), never re-fetched from the device |
| **Offline sync/outbox (`pushMutations`)** | Yes, and unbounded | **No date-range clamp at all** — `MutationSchema.date` validates calendar-date *shape* only | Every queued mutation carries its own `date`; a device offline for weeks pushes each mutation stamped with its original date. This is the most permissive backfill path in the app, but it's a byproduct of offline-first mutation queuing, not a designed "request history" feature — it only helps a device that already had the data locally and couldn't send it, not a device asking an external source for more history than it currently holds |
| **Admin-only derived-score recompute** | Recompute, not re-fetch | 31 days/call (`MAX_RANGE_DAYS`, `app/api/admin/backfill-derived-scores`) | Re-runs Sleep/Readiness scoring over already-stored raw data. Doesn't pull new external history — repairs scores after a formula change, the same job §5.1's "redecode" does for raw Oura frames |

**No generic "pull N days of history from a newly connected source" capability exists** for
`body_metrics`/`sleep_sessions` from an external platform. The closest thing — Health Connect's
30-day cold sync — is capped below what most platforms could actually supply (a year+ of Health
Connect history commonly exists on a phone that's had a watch paired for a while), and the cap is a
client heuristic, not a deliberate product decision recorded anywhere.

### 9.2 What a new source should support

A connector should expose backfill as **a distinct capability from live sync**, not an accident of
how the live-sync window happens to be sized:

1. **A bounded, resumable historical pull**, following the admin-backfill pattern already in the
   codebase (§9.1's last row): request N days at a time, return what it wrote plus a cursor/remaining
   count, safe to call repeatedly until exhausted. Never one unbounded "give me everything" call —
   the existing bounded-batch pattern (`maxRows`/`maxBuckets` across every admin backfill route in
   this app) exists specifically because an unbounded historical pull is the shape that produces a
   gateway timeout (see the module-map row "Long admin operations — return a job id, do not hold the
   request").
2. **Idempotent against the live-sync path** — a backfill call and the next scheduled live sync must
   not double-count or conflict; writing through the same `upsertX(..., source)` ranked-merge path
   (§6) already guarantees this for free, so a backfill implementation should never bypass it for a
   raw insert.
3. **Explicitly user-triggered, not automatic on every app open** — a large historical pull is
   expensive (rate limits on the platform side, DB write volume) and should be a deliberate action
   ("import my history"), not something that fires silently on first connect. Health Connect's
   current 30-day cold sync already does this implicitly and correctly for the common case; a
   connector wanting *more* history should be an explicit user action, not a bigger default window.
4. **Raw-capable (BLE) sources cannot generally backfill from the device** — §9.1's Oura row is the
   general case, not an Oura-specific limitation: a device's own history buffer is almost always
   finite and forward-draining. Treat "can this source backfill?" as a computed-source question by
   default; assume no for a new raw-capable device unless its protocol specifically documents a
   historical-read command.

---

## 10. Proposed: a formal `DataSourceConnector` shape (design only — not implemented)

Everything above already exists as a *convention* independently re-derived per source. Nobody has
had to violate it yet because there have only been six sources total, each added by someone who read
the previous one's code. That stops scaling the moment a third-party or community-contributed
connector is wanted. The following is a proposed shape to make the convention explicit and
machine-checkable — **filed as PS-40 in the implementation backlog, not built in this doc-only
session** (per `CLAUDE.md`'s backlog-driven-implementation rule).

```ts
interface DataSourceConnector {
  id: string;                          // e.g. 'oura_ble', 'health_connect', 'garmin_hc'
  tier: 'raw' | 'computed' | 'manual';
  isolation: 'scored' | 'learning_mode';
  healthSource?: HealthSource;         // required if isolation === 'scored'
  supplies: DataType[];                // subset of the §3 catalog this source can provide
  ingestRoute: string;                 // the app/api route it POSTs to (live sync)
  backfill?: {                         // absent = no backfill capability (§9.2)
    maxDaysPerCall: number;
    route: string;                     // may be the same as ingestRoute with a mode flag
  };
}

type DataType =
  | 'heart_rate_series' | 'rr_intervals'
  | 'sleep_session' | 'daily_body_metrics'
  | 'activity_session' | 'raw_signal';
```

Declaring `supplies` against §4's calculation-input table is what would let a future "connect a new
device" screen say, honestly, *"this source can improve your Sleep Score and Readiness, but not your
Body Battery or stress score"* — rather than either overpromising or hiding the distinction the app
already computes correctly today via `inputsAvailable`/`inputsMissing`
(`lib/health/score-availability.ts`).

---

## 11. Worked example — adding a new generic ring or strap

1. **Classify it** (§1): raw BLE signal, or does it only appear inside Health Connect / a vendor
   app? If the latter, you likely need **no new code at all** for live sync — the existing Health
   Connect pipeline is vendor-agnostic by construction.
2. **If it's raw BLE:** decide scored vs. learning-mode (§7) before writing a single decoder byte.
   Start in learning mode until you've run the comparison-against-ground-truth method in
   `docs/multi-device-comparison.md`.
3. **Verify the protocol against the device's real behavior, not marketing docs** — this has gone
   wrong three times already for existing sources (`CLAUDE.md`'s "External API & Plugin Field
   Names" rule).
4. **Pick the §3 shapes it can supply**, and cross-reference §4 to know honestly which
   calculations it will and won't improve. Only build what the device actually emits.
5. **Write the decode → normalize → write pipeline** per §5, targeting the exact §3 shapes — never
   a parallel device-specific representation.
6. **Write the ingest route** following §8's checklist, reusing an existing sibling route as the
   template.
7. **Decide its backfill story explicitly** (§9.2) rather than leaving it unstated — "no backfill,
   live-only" is a valid answer, but it should be a decision, not a gap nobody noticed.
8. **Add the client-side wiring**: BLE scan/connect (name/manufacturer-id, never MAC), batch-and-
   post, cache invalidation on success, offline-first local-store + outbox writes if applicable.
9. **Document which pillar(s) consume it** — update `docs/domains/<pillar>/README.md` and, if it's
   genuinely new shared infrastructure, `docs/module-map.md`.
10. **On-device verification is mandatory for anything BLE.**

---

## 12. What this buys the existing pillars

| Pillar | Reads (generic) | Calculations affected (§4) |
|---|---|---|
| `heart-rate` | `oura_heartrate`, `rr_intervals`, `daily_zone_minutes` | Readiness (recovery-index), Activity Score (zone/move), Body Battery |
| `sleep` | `sleep_sessions`, `oura_daily_derived` | Sleep Score, Readiness (previous-night) |
| `readiness` | `body_metrics`, `sleep_sessions`, `oura_daily_derived` | Readiness composite, illness radar |
| `activity` | `body_metrics.steps/distanceKm/activeCalories`, `activity_logs` | Activity Score |
| `cardio` | `activity_logs`, `oura_heartrate` | ACWR, OTS training stress |
| `body` | `body_metrics` | — (direct display, no scoring formula) |
| `devices` | owns the transport + normalize layer | — |

A source supplying only a subset of §3 is fine — §4 states exactly which calculations degrade
gracefully (Readiness, Sleep Score, Activity Score) versus which have no fallback at all (chronic
stress, resilience, Body Battery, OTS). That distinction should be shown to the user, not hidden —
see §10's `supplies` field.

---

## 13. What the app requires — the full Layer-1 input list

§0 promised this: the complete set of "device data, computed" values every score in the app draws
from, split by whether it powers baseline scoring (any source can supply it, Oura included via its
own models) or the deeper stress/recovery layer (today, Oura-only — not because the math is
ring-specific, but because no other source has been wired to fill this shape yet).

### Core — Sleep Score, most of Readiness, Activity Score, training load

| # | Input | Shape (§3 ref) | Feeds | Oura's route to it | A typical other device's route to it |
|---|---|---|---|---|---|
| 1 | Sleep session: start/end, stage totals, duration | §3b | Sleep Score, Readiness | our SleepNet model on raw motion/HR/temp (§5.6) | vendor's own stage detection, handed over finished |
| 2 | Daily steps | §3c | Activity Score | our gait/ONNX step model on raw accelerometer (§5.6) | vendor's own step count, handed over finished |
| 3 | Daily active calories | §3c | Activity Score, energy balance | derived from our HR/MET-based estimate | vendor's own estimate |
| 4 | Resting heart rate | §3c | Readiness | our lowest-5-min-bin aggregation over ring-computed bpm (§5.6) | vendor's own RHR figure |
| 5 | HRV (nightly) | §3c | Readiness | the ring's own computed rMSSD, quality-selected not recomputed (§5.6) | vendor's own HRV figure |
| 6 | Intraday heart-rate series | §3a | Activity Score (zone/move time), recovery-index | ring-computed bpm from IBI, trivial conversion (§5.6) | vendor's HR series, if exposed (Health Connect's is currently **not** normalized in — §5.5, PS-41) |
| 7 | Body weight / composition | §3c | `body` pillar | — (ring doesn't measure this) | scale, or Health Connect |
| 8 | Logged strength workouts | §3d-adjacent | ACWR, Activity Score's strength lane | always user-entered, no device involved either way | same |

### Extended — stress, resilience, Body Battery, illness radar, training-stress score

| # | Input | Shape | Feeds | Oura's route to it | Why nothing else supplies it today |
|---|---|---|---|---|---|
| 9 | Skin temperature samples (periodic) | time series | Readiness's temperature term, illness radar, chronic stress | ring-computed samples, we aggregate (§5.6) | Health Connect has no periodic-temperature record type in the app's current read list (`lib/health-connect-sync.ts`'s `HC_SYNC_READ_TYPES`) |
| 10 | Fine-grained HRV (~5 min cadence) | time series | Chronic stress, resilience | the ring's own `0x5d` samples, decoded directly (§5.6) | Health Connect exposes only a daily/session HRV figure, not a 5-min series. **The Polar strap could already supply this one** — its raw RR intervals are already flowing into the app, and a standard rMSSD calculator (`rmssdFromRr`) already exists and runs on that exact data, just not wired to this pipeline yet (§5.7, PS-44) |
| 11 | MET / activity-intensity series (per-minute) | time series | OTS training-stress score, daytime stress | the ring's own `0x50` activity-info stream, decoded directly (§5.6) | no equivalent fine-grained record is read from Health Connect today |
| 12 | SpO2 | number/night | Illness radar (optional) | our own uncalibrated formula from raw ring sensor data — the weakest link even for Oura (§5.6) | Health Connect can supply this; not yet normalized into the illness-radar path (same class of gap as #6, not separately filed) |
| 13 | Respiratory rate | number/night | Sleep Score bonus, illness radar | our own median-of-epochs from ring IBI (§5.6) | not commonly exposed by other platforms either |

**Reading the two tables together:** items 1–8 are already device-agnostic in the running app —
swap the ring for Health Connect today and each one still gets filled, just by a different route.
Items 9–13 are the real "Oura-only" surface. None of them are architecturally tied to the ring —
§5.6 shows each is either our own aggregation over a ring-computed intermediate, or (for SpO2) an
already-weak formula that isn't uniquely an Oura problem. **What's actually missing for a second raw
device or a richer computed source to close this gap is a Layer-1 supplier for #9-#11's shapes** —
periodic temperature, sub-hourly HRV, and per-minute activity intensity — which is a real, scoped
integration project (a new BLE source's decode+normalize step, or extending what's read from Health
Connect / a future HealthKit connector), not a rewrite of any formula in §4.

---

## References

- [`docs/sync-health-api-reference.md`](sync-health-api-reference.md) — **the actual, code-derived
  JSON request/response contract for the one generic ingestion endpoint that exists today**
  (`POST /api/sync-health`) — exact field names, types, nullability, rejection rules, and the honest
  gap (no external API-key auth yet, PS-45). Send someone here when they want to connect their own
  device, not to this design doc.
- [`docs/superpowers/plans/2026-09-14-apple-healthkit-ios-connector.md`](superpowers/plans/2026-09-14-apple-healthkit-ios-connector.md)
  — a buildable plan for the Apple HealthKit connector (PS-46), mirroring Health Connect's real
  implementation field-by-field. iOS-side work only; the backend already accepts what it produces.
- [`device-agnostic-source-architecture.md`](device-agnostic-source-architecture.md) — the goal, the
  tiers, the invariants. Read first.
- [`docs/oura-ble-operations.md`](oura-ble-operations.md) — the operations manual for the one
  raw-capable source that ships today; the reference implementation for §3e/§5's decode+normalize
  pipeline.
- [`docs/multi-device-comparison.md`](multi-device-comparison.md) — how to validate a new source
  against ground truth before trusting it for scoring.
- [`docs/superpowers/plans/2026-08-26-alternative-ring-colmi-testing.md`](superpowers/plans/2026-08-26-alternative-ring-colmi-testing.md)
  — the reference implementation for §7's isolation pattern.
- [`docs/domains/devices/README.md`](domains/devices/README.md) — the `devices` pillar index; read
  before touching any transport code.
- `lib/data/health-source.ts`, `packages/shared/src/health/source-rank.ts` — the provenance
  mechanism in code.
- `packages/shared/src/health/readiness-composite.ts`, `sleep-score.ts`, `activity-score.ts`,
  `chronic-stress-assembly.ts`, `illness-radar.ts`, `body-battery-walk.ts`,
  `ai-periodization/acwr.ts`, `training-stress.ts` — the calculation source files behind §4.
