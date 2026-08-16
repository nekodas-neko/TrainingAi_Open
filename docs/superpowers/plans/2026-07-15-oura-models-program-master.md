# Oura On-Device Models — Program Master Plan

**Date:** 2026-07-15 · **Status:** In progress — Phase-0 enablers + pure cores merged (PRs
#525–#531). **Continuation guide:** [`2026-07-15-oura-program-handoff.md`](2026-07-15-oura-program-handoff.md)
(read it first; it has the merged-status table and the cloud-session next steps). · **Owner runtime:**
S25 APK (canonical), BLE-only ring.

> This is the **hub**. It defines the vision, the phasing, the cross-cutting architecture every
> sub-plan obeys, and the index of sub-plans + backlog entries. Model math is NOT repeated here —
> it lives in the **`oura-models` skill** (`.agents/skills/oura-models/`) and the committed
> constants bundle (see the constants-ingestion sub-plan). Read the skill first.

---

## 1. Why this program exists

Since the 2026-07-07 BLE re-key the Oura Cloud gets no new data, so **every finished metric the
ring's app used to compute is frozen unless we recompute it ourselves** from raw BLE signals. We
already do a partial job in `lib/health/*`. We now hold the **decrypted on-device model suite**
(31 models) *and* their **extracted numeric constants** (SHA-pinned JSON, all 31, zero extraction
errors — see `MANIFEST.json`). That removes the last blocker: every rule-based model is now fully
specified, and every neural model's weights are available.

**Goal of the program:** compute, in *completed form*, every Oura-derived metric we can — sleep
(stages/score/times/latency/efficiency), readiness, activity score, steps, energy expenditure,
training load, illness radar, stress/resilience, and (feasibility-gated) vascular age and a body-
composition panel — persist them durably for analysis, and **stop hoarding raw data we don't
need** so the Railway DB stops growing unbounded.

Two first-class, cross-cutting objectives run alongside the features:
- **Record everything in completed form** (§4) — derived metrics become durable rows, not
  recompute-on-read, so we have an analysis-ready history.
- **Cull ingestion bloat** (§5 + the data-architecture sub-plan) — the DB is blowing up; we now
  know what we need, so we retire what we don't.

---

## 2. The three tiers (recap) and where we operate

| Tier | Produces | Us |
|---|---|---|
| Ring firmware | raw IBI, PPG, accel/MAD, skin-temp, SpO₂ r/pi, MET, step-feature packets | capture over BLE |
| **Phone (these 31 models)** | steps, stages, HRV analytics, scores, stress, vascular age | **we reimplement this tier** |
| Cloud | workout auto-tagging, SpO₂ optical | out of scope / frozen |

Our reimplementation lives in `lib/health/*` + `aggregateOuraRawSamples` (`lib/data/postgres/adapter.ts`).
The models in the skill are the ground truth this tier approximates.

---

## 3. Feasibility triage (what we can build, from the capture audit)

| Feature | Inputs captured? | Verdict |
|---|---|---|
| Sleep stages / score / times / latency / efficiency | ✅ movement `0x72`, HR, HRV `0x5d`, temp | **Build** (feature-stack upgrade) |
| HRV/RHR median + quality gating | ✅ `0x5d`, IBI | **Build** (P1, cheap) |
| Personal baselines, readiness, recovery index, temp deviation | ✅ derived nightly metrics | **Build / improve** |
| Activity score | ✅ steps + active-cal + logged volume | **Build** (persist + MET upgrade) |
| Steps | ✅ `0x7e/0x7f` gait vectors (estimate); ⚠️ accurate accel opt-in only | **Build** (decoder port; accel is a stretch) |
| Energy expenditure | ✅ `0x50` MET per-bin + HR (currently day-averaged only) | **Build** (new consumer) |
| Training load (OTS) | ✅ HR series + MET | **Build** |
| Illness radar | ✅ temp/RHR/HRV/breathing baselines already computed | **Build** (rule-based) |
| Daytime / cumulative stress, resilience | ✅ HR/HRV/temp; EDA `0x59` untapped | **Build** (rule-based; some need archived tensors — we have them) |
| Vascular age / PWV | ⚠️ `0x81` raw PPG decoded but **unvalidated, unconsumed, rate-unpinned**; true raw-PPG `0x64/0x68` undecoded | **Spike first** — capture-validation gated |
| Body composition panel | ✅ we store weight + body-fat% | **Build** (pure arithmetic; no bioimpedance) |
| Auto exercise detection | ❌ needs continuous all-day accel; `0x33` is opt-in, time-boxed, preempts HR/SpO₂/steps | **Capture-gap R&D first** — do not schedule the model until capture is solved |

**Two hard gaps to call out up front:** continuous all-day accelerometer (blocks auto-exercise
detection) and validated continuous raw PPG (blocks vascular age). Both are *capture* problems, not
*model* problems — the models are ready; the ring plumbing is not. They get spike sub-tasks, not
feature commitments.

---

## 4. Cross-cutting architecture — every sub-plan obeys these

### 4.1 "Completed form" storage — analysis-first, read-path only if performance needs it
> **Priority note (owner directive, 2026-07-15):** the **unconditional** goal is **not storing raw
> data we don't use** — freeing DB space (§5). Persisting derived metrics in completed form is
> **desirable but secondary**, and its read-path variant is **performance-gated**. Do not let the
> completed-form table become a reason to *keep* raw we could drop — if anything it's the enabler
> for dropping it (derive → persist the small finished form → the bulky raw becomes disposable).

Separate the two motivations — they have different cost/benefit and only one is conditional:

- **(a) Analysis record — always do it, it's cheap.** Introduce one durable **`oura_daily_derived`**
  table (one row per user per local day) holding the *finished* outputs of every derived model
  (scores, sub-scores, contributors, scalar sub-metrics). The rollup writes a daily snapshot. This is
  a small per-day row; it exists so we have an analysis-ready history **and** so the underlying raw
  can later be culled/cold-stored without losing the derived signal. `oura_daily_summary` (baselines
  + nightly physiology) stays as-is; `oura_daily_derived` is the scored layer on top.
- **(b) Read-path optimization — only where a measured paint cost justifies it.** Today sleep score,
  activity score and readiness are recomputed on every read (`app/api/readiness-score/route.ts`).
  Converting a surface to **read-first from `oura_daily_derived`** is worth doing where the live
  recompute is measurably slow, but it is **not a blanket mandate** — a metric that is cheap to
  compute live can keep doing so. Prefer read-first for the heavy ones (the sleep feature stack, OTS'
  720-min windows); leave the cheap ones live if that's simpler. Measure before converting.

**Rule (revised):** every newly-derived metric is *snapshotted* to `oura_daily_derived` for analysis
in the PR that computes it (cheap, always). Making a surface *read* from it instead of recomputing is
a per-surface decision driven by a measured cost — not automatic. Recompute always remains a valid
path; persistence is an optimization + an analysis record, never a correctness dependency.

### 4.2 Model constants are vendored, versioned, SHA-pinned
The extracted constants (`oura_models_bundle_lite → oura_model_constants/*.constants.json`) are the
single source of truth for every ported formula. Small rule-based constants are committed to the
repo; large NN weights are handled per the constants-ingestion sub-plan. A port never hardcodes a
magic number that exists in the bundle — it loads it from the vendored, version-tagged constant
(One-Formula-One-Place extends to One-Constant-One-Source).

### 4.3 Redecode discipline is preserved
`oura_raw_samples.body_hex` stays archival and immutable (CLAUDE.md). Every new decoder/derivation
must be **replayable** over stored `body_hex` via the existing redecode path — so a better model
back-fills history without re-draining the ring. New completed-form outputs are (re)written by the
same idempotent rollup.

### 4.4 Compute location
All derivation runs **server-side in the rollup** (`aggregateOuraRawSamples`), not on-device and not
in the browser — consistent with today. Neural models (if we run any) run server-side. No PyTorch in
the WebView.

### 4.5 Rollout & verification
Each feature ships behind its existing surface with a **device-verification gate** (offline-first /
native / BLE behaviour is only real on the S25 APK per Canonical Runtime). Every sub-plan lists its
device-smoke step or a Known-Issues row if not device-verified in-session. New formulas get unit
tests against a **pinned test vector** (a captured/redecoded night), mirroring the Oura-BLE decoder
discipline.

### 4.6 Provenance labelling
Every persisted derived value carries its `source` (`oura-cloud` | `ble-derived` | `manual`) and a
model/constant version, so analysis can tell which pipeline produced a number and re-derive when a
model version bumps. (Extends the existing provenance work.)

### 4.7 Rollup compute cost — derive once per day, not per ingest batch
The new derivations (sleep feature stack, OTS 720-min windows, illness, stress) add real CPU to
`aggregateOuraRawSamples`, which runs on **every** ingest batch. Since the derived outputs are daily,
recomputing them on every mid-day drain is wasted work and a latency risk. **Decision:** gate the
expensive daily derivations to run **at most once per (user, day)** unless that day's inputs changed
(dirty-flag or a cheap input-hash), and keep the cheap per-sample aggregation on every batch. Measure
rollup wall-time before/after each sub-plan; if a derivation is heavy, compute it on the
end-of-day/first-drain-after-midnight pass, not continuously. This directly serves the owner's
performance concern — persistence must never make ingestion slower.

---

## 5. Data-culling strategy — THE primary, unconditional goal

**This is the top priority of the program** (owner directive: "the DB is blowing up… we don't store
raw data we don't use… free up space"). It is independent of the derivation features and should ship
**first and fast** — it does not wait on the completed-form table or any model port.

The DB-bloat audit ranked footprint: `oura_raw_samples` (unbounded, `body_hex` **+** a redundant
`decoded` JSONB — the double payload) dominates long-term; `oura_accel_chunks.magnitudes int[]`
dominates instantaneous write pressure (already 7-day pruned); `oura_heartrate` (180-day pruned);
`step_live_windows` (**unbounded, no retention**). Only ingest-time throttled prunes exist — no cron.

**Levers, in priority order:**
1. **Stop storing the redundant `decoded` JSONB** on `oura_raw_samples` (fully re-derivable from
   `body_hex` via redecode). ~halves the biggest table. **Ship this first — it's the fastest win and
   needs no other work.**
2. **Whitelist which tags get raw-stored at all** — pure telemetry/debug/state tags
   (`0x43/0x45/0x53/0x56/0x5b/0x61/0x79/0x82/0x83/0x42`) carry no analytical or redecode value; stop
   persisting raw rows for them. This is the direct "don't store what we don't use" fix.
3. **Add retention to `step_live_windows`** (unbounded today) once rolled into completed-form.
4. **Downsample/retain `oura_heartrate`** to the resolution the models actually need.
5. **Aged `body_hex` — retention/cold-storage (policy shift the owner has signalled openness to).**
   CLAUDE.md currently says *never prune `body_hex`* (it's the redecode source of truth). The owner's
   directive — *"record and analyse and delete raw data later"* — explicitly relaxes this: once a
   day's raw has been decoded into the completed-form + the derived series we keep, the bulky
   `body_hex` becomes a candidate for **deletion or compressed cold-storage after an analysis
   window** (e.g. N months). **The tradeoff to accept consciously:** deleting `body_hex` forfeits the
   ability to back-fill a *future, better* decoder over that span — so the retention window must be
   long enough that decoders have stabilised. Recommendation: ship Levers 1–4, measure, then set a
   `body_hex` retention window (cold-store before hard-delete). This is data-dropping → **confirm the
   exact window with the owner before it ships**, and update the CLAUDE.md archival rule in the same PR.

**How completed-form *serves* culling:** persisting the small finished daily row (and the compact
derived series we actually use) is what *makes the raw disposable* — we're not keeping raw "just in
case", we're deriving what we need, storing that compactly, and then dropping the raw. Record-then-cull,
not record-and-hoard.

---

## 6. Phasing

**Phase 0a — Cull now (ship first, standalone, no dependencies).**
- Culling levers 1–3 (stop persisting `decoded` JSONB, tag whitelist, `step_live_windows` retention).
  This is the owner's top priority ("free up space") and needs none of the other work — a fast first
  PR. Measure DB size before/after. (Lever 5 — `body_hex` retention — is confirm-first, follows later.)

**Phase 0b — Enablers (unblock the derivation work).**
- Constants ingestion (vendor + typed loader) — constants-ingestion sub-plan.
- `oura_daily_derived` completed-form table — **created once, up front, with ALL known columns**
  (nullable) from every sub-plan, so domain PRs only *write* to it and never race on `ADD COLUMN`
  ordering. Migration numbers for the whole program are allocated in one table in the
  data-architecture sub-plan (avoids parallel-PR collisions).
- **Shared test-vector fixture:** capture + commit a small set of canonical redecoded days (a normal
  night, a workout day, a logged walk) as the single fixture every sub-plan pins its expected outputs
  to. Without this, each implementer re-captures ad hoc and the pins drift.

**Phase 1 — Cheap, high-value correctness (no capture work, no new tensors needed).**
- HRV/RHR → quality-gated **median** (fixes the confirmed naive-mean bug).
- Persist sleep score, activity score, readiness + contributors in completed form.
- Illness radar (rule-based over baselines we already compute).
- Body-composition panel (arithmetic on weight + body-fat%).

**Phase 2 — Model-fidelity upgrades (rule-based ports, constants now available).**
- Sleep: port the `sleepstaging_2_6_0` feature stack (CSI/HF/BRV/rRR/LIDS + rolling + RobustScale)
  → break the REM plateau.
- Steps: port `steps_motion_decoder` → count from `stride_frequency`.
- Training load (OTS) + energy expenditure from the MET stream.
- Daytime stress, and personal-baseline reconciliation vs Oura's centered-Gaussian.

**Phase 3 — Capture-gated / heavy.**
- Vascular age: PPG-capture validation spike → (if it passes) CVA port + calibrator.
- Auto exercise detection: continuous-accel capture R&D → AAD model.
- Cumulative stress / resilience (need archived tensors — we have them; medium effort).
- Optional: running the SleepNet neural nets server-side if the feature stack still misses baseline.

Phases 0→1 have no blockers today. 2 depends only on Phase 0. 3 is gated on capture spikes.

---

## 7. Sub-plan index & backlog

| # | Sub-plan | Covers | Backlog branch |
|---|---|---|---|
| A | `2026-07-15-oura-data-architecture-and-culling.md` | completed-form table, retention/culling, migrations | `feat/oura-data-architecture-culling` |
| B | `2026-07-15-oura-model-constants-ingestion.md` | vendoring constants, typed loader, versioning | `feat/oura-model-constants-ingestion` |
| C | `2026-07-15-oura-sleep-staging-and-scores.md` | stages, score, times, latency, efficiency, breathing | `feat/oura-sleep-feature-stack` |
| D | `2026-07-15-oura-movement-steps-activity-energy.md` | steps, activity score, energy expenditure, training load, AAD spike | `feat/oura-movement-metrics` |
| E | `2026-07-15-oura-recovery-readiness-and-health-events.md` | HRV/RHR median, baselines, readiness, recovery index, temp, illness radar, stress, resilience | `feat/oura-recovery-health-events` |
| F | `2026-07-15-oura-cardio-and-body-composition.md` | vascular age spike + port, body-composition panel | `feat/oura-cardio-bodycomp` |
| G | `2026-07-15-oura-admin-console-domain-sections.md` | admin console → domain collapsible sections + per-domain device-test cards | `feat/oura-admin-console-sections` |

Backlog ordering rationale: **B and A first** (enablers), then **E-Phase1 + C** (highest downstream
value — sleep feeds readiness), then **D**, then **F** (capture-gated). Each sub-plan is independently
implementable and carries its own task list, tests, and device gate.

---

## 8. Non-goals / explicitly out of scope
- Hypertension (`halite`) and the full bioimpedance body-composition model (`atlas`) — no hardware
  / low value.
- Reproductive models (`popsicle`, `pregnancy_biometrics`) — N/A to the user.
- Re-onboarding the official Oura app to "unfreeze" Cloud — forbidden (firmware/protocol risk).
- Shipping PyTorch into the WebView — server-side only if we run nets at all.
