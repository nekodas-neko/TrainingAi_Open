# Oura BLE — Sleep Staging Phase 1b: Further Heuristic Signal Upgrades

**Date added:** 2026-07-11
**Branch:** `feat/oura-ble-sleep-staging-phase1b`
**Parent item:** backlog item 4, plan `docs/superpowers/plans/2026-07-09-oura-ble-accurate-sleep-staging.md`,
findings `docs/oura-ble-sleep-staging-findings.md`
**Source:** a fresh web sweep of the Oura reverse-engineering ecosystem (`Th0rgal/open_oura`,
`ringverse/protocol`, `LogosIsLife/open_ring`) turned up nothing that changes the existing
finding — this ring emits zero ring-computed stage data over BLE, and SleepNet remains
AES-256-GCM encrypted with a server-delivered, login-only key. Nothing new to act on there;
this plan is the other half of that research — legitimate signal-processing upgrades to our
own heuristic stager, drawn from general wearable-sleep-staging literature (LF/HF HRV,
ultradian rhythm modelling, SpO₂-based REM correlates, data-driven threshold fitting), not
from any Oura-specific source.

## Why this is a separate phase, not more `REM_Z` tuning

The findings doc is explicit that **both existing heuristic levers are exhausted**: `REM_Z`
cutoff tuning went dead at 0.35 (0.0h change), and `W_BREATH` net-flat. Session 259 already
found one genuinely new lever (cross-epoch Viterbi bout-decoding, replacing the per-epoch cutoff
decision unit) — this plan continues in that spirit: **new information or a new decision
method**, not another nudge of an already-flat knob.

Phase 2 (running the actual SleepNet model) remains the only path to true Oura-parity REM, and
it's already active — the owner is pursuing the model-key extraction per item 4's parked
procedure. **This plan is explicitly not competing with Phase 2.** It's additional, unblocked,
in-sandbox work that:
- improves the heuristic's honesty in the meantime (Phase 2 extraction may take a while, or may
  not pan out — anti-tamper/root detection is the named risk),
- stays useful as a sanity-check/fallback even after Phase 2 ships (a still-running heuristic to
  validate the model's output against, and a source of engineered features that could feed a
  model-assisted pipeline too), and
- doesn't touch anything Phase 2 will touch (Phase 2 replaces the stager's *output*; this plan
  only changes the stager's *inputs and decision structure*), so the two can land in either order
  with no rebase conflict in the areas that matter.

**Same honesty ceiling as before applies to all four items below:** we still have no ground
truth (BLE raw and old Cloud stages never overlap in time — CLAUDE.md's Oura Direct-BLE section
forbids re-onboarding the official app to get one). Success is still judged the same soft way
the findings doc already uses: does REM% trend toward the owner's ~23–28% Cloud-era baseline,
does the ribbon look physiologically sane, does a real redecoded night move in the expected
direction. Ship each item as its own small, reversible PR with the same per-symptom tuning
discipline and inline-comment history the existing constants already follow.

---

## Item 1 — Frequency-domain HRV (LF/HF ratio) as a REM/deep discriminator

**What:** REM sleep is characterised by relative sympathetic dominance (lower high-frequency
[HF, 0.15–0.4 Hz, parasympathetic/vagal] power, higher low-frequency [LF, 0.04–0.15 Hz] power,
i.e. a higher LF/HF ratio); deep sleep is the opposite (parasympathetic-dominant, high HF, low
LF/HF). This is a *different* axis of information from what the stager currently uses —
time-domain RMSSD (`hrv`, from the sparse `0x5d` samples) and within-epoch HR spread (`hrVar`)
both measure variability *magnitude*, not its *spectral distribution*.

**Why now / why cheap:** `lib/health/breathing-rate.ts` already builds exactly the artifact this
needs — an evenly-resampled, detrended IBI tachogram per epoch (2 Hz grid, `DETREND_WIN`-smoothed).
Computing LF/HF from that same grid is a Welch/Lomb-Scargle periodogram away, reusing the
resampling code rather than duplicating it. (Note: standard LF/HF windows are usually computed
over ≥2–5 min; our 5-min epoch is right at the edge of what's meaningful for LF — treat the
result as a coarse discriminator, not a clinical HRV metric, same caveat the breathing-rate file
already states for its own output.)

**Scope:**
- New pure function, e.g. `lib/health/hrv-frequency.ts`, taking the same `ibiMs: number[]` input
  `breathingFromIbi` takes (or refactor the shared resample+detrend step into a small internal
  helper both files import, to avoid duplicating that logic — check for the cheapest shared-code
  shape at implementation time).
- Output: `{ lfHfRatio: number | null }`, null under the same sparse-beat conditions
  `breathingFromIbi` already guards against (reuse `MIN_BEATS`-equivalent).
- Wire into `SleepEpoch` as a new optional field (`lfHf?: number | null`), z-scored the same way
  `hrVar`/`breathVar` already are in `lib/health/sleep-staging.ts` (self-neutralising: null →
  zero contribution, no behaviour change on nights without enough beat density).
- New weight constant `W_LFHF`, added at a conservative starting value (e.g. 0.2, smaller than
  the validated `W_BREATH = 0.7`) since this is an unvalidated signal — same "start conservative,
  raise or drop per redecoded-night evidence" pattern the existing constants document in their
  inline history comments.
- Unit tests: synthetic tachograms with known dominant-frequency content (e.g. a slow ~0.1 Hz
  oscillation vs a fast ~0.3 Hz oscillation) should discriminate correctly; sparse input → null.
  Follow `lib/health/__tests__/sleep-staging.test.ts`'s existing pattern (mechanics/invariants,
  not tuned to an exact cutoff).

**Honest limits:** short 5-min epochs give a coarse LF/HF estimate at best; if the debug dump
shows it's mostly noise (weakly bimodal, like `brVar` turned out to be per session 246), that's a
valid negative result — record it in the findings doc and don't force the weight up.

---

## Item 2 — Explicit ultradian (~90 min) cycle-position prior, replacing the linear `W_TIME` term

**What:** `W_TIME` currently applies `1 - 2*pos` / `2*pos - 1` — a straight linear skew favouring
deep early in the night and REM late. Real sleep architecture is periodic, not linear: NREM/REM
cycles run roughly 90–110 minutes, with REM proportion *within* each cycle growing across the
night (short/absent in cycle 1, dominant by cycle 4–5) rather than smoothly ramping the whole
night through.

**Why this matters for the REM ceiling specifically:** the findings doc's session-250 dump
showed the ~22:48–04:13 stretch (prime REM-cycle territory) reading as "moderate everything" —
no single-epoch signal is decisive there. A periodic prior that expects REM concentration to
recur roughly every 90 minutes, rather than monotonically increase, is a genuinely different
piece of structure than what `W_TIME` currently encodes — it could tip epochs inside an expected
REM window that the linear term (still ramping toward "late" but not there yet, mid-night) scores
neutrally.

**Scope:**
- Replace (or add alongside, gated by a feature flag/constant during rollout) the `1 - 2*pos`
  term with a periodic function anchored to onset — e.g. a raised-cosine or similar smooth
  function with period ≈ 90–100 min (start with the physiological literature's typical range,
  tune the exact period against real nights same as everything else here), phase-shifted so its
  peaks fall later and grow relative to a baseline that still favours deep early / REM late
  overall (don't lose the correct coarse trend the linear term already captured — the periodic
  term should modulate around that trend, not replace the whole "REM skews late" prior).
- Anchor the cycle clock to `onsetEpoch` (sleep actually starting), not the raw window start —
  reuse the existing onset-detection the stager already computes.
- This is a pure-math change inside `stageSleepDetailed`'s existing scoring loop — no new decoded
  signal, no new `SleepEpoch` field, smallest-blast-radius item in this plan.
- Unit test: on a synthetic multi-cycle night, confirm periodic troughs/peaks land near the
  expected ~90-min marks rather than a smooth monotonic ramp.

**Honest limits:** individual cycle length varies (85–120 min is a wide normal range) and drifts
across the night (cycles lengthen later on) — a fixed-period prior is an approximation. If it
doesn't help (or hurts, e.g. by fighting the Viterbi bout-decoder's own transition structure),
the fallback is reverting to the linear term — this is exactly why it should ship as its own
small, easily-revertible PR rather than bundled with the other items.

---

## Item 3 — SpO₂ variability as a fourth independent REM/wake signal

**What:** the rollup already decodes oximetry (`0x8b` r/PI → `spo2.ts`) into per-epoch SpO₂ %,
but it isn't fed into the stager at all today. Breathing irregularity in REM (and at wake
transitions) often shows up as SpO₂ micro-variability, independent of the cardiac/breathing
signals already in use — a legitimate fourth cross-check in the same "independent physiological
correlate of REM" family as `hrVar` and `breathVar`.

**Scope:**
- New `SleepEpoch` field `spo2Var?: number | null` — per-epoch SD (or CV) of the within-epoch
  SpO₂ readings, computed wherever the rollup currently bins SpO₂ into epochs for
  `aggregateOuraRawSamples` (mirror however `hrVar`/`breathVar` are currently populated at that
  call site).
- Z-scored and folded into the REM/depth score in `lib/health/sleep-staging.ts` exactly like
  `breathVar` (same self-neutralising null-when-sparse pattern), new weight `W_SPO2`.
- This is the cheapest item in the plan — the decoder and per-epoch SpO₂ values already exist;
  it's purely a "compute variance instead of just the mean, and wire it into the score" change.
  Do this one first if sequencing by effort.
- Unit tests mirroring the `breathVar` addition's test shape.

**Honest limits:** finger/ring-worn SpO₂ variability during sleep is subtler and noisier than
daytime readings; the debug dump (`/admin/oura-ble` → "Sleep epochs (debug)") should gain an
`spo2Var` column (same pattern as the existing `brVar` column) so this can be judged from real
data before its weight is raised beyond a conservative starting value, exactly like the other
new terms.

---

## Item 4 — Data-driven threshold fit (unsupervised clustering) instead of one-dimension-at-a-time nudging

**What:** every tuning pass so far (`REM_Z`, `W_BREATH`, `REM_SWITCH`) has changed one scalar at
a time and read the effect off 2–3 redecoded nights. That's necessary given the debugging
constraints, but it's also a weak way to set a *multivariate* decision boundary — the real
separation between REM/light/deep epochs likely lives in a combination of signals (HR, HRV,
`hrVar`, `breathVar`, and the new `lfHf`/`spo2Var` from items 1 and 3), not any single weighted
sum's cutoff.

**What this is NOT:** this is not proposing an online/automatic model swap. It's an **offline
analysis tool** that a human (or an agent session) runs against accumulated real per-epoch data
to *suggest* better constants — the actual constant changes still ship as the same kind of small,
reviewed, inline-commented PR every other tuning change in this codebase has used.

**Scope:**
- A one-off analysis script (not a shipped runtime module — put it under something like
  `scripts/analyze-sleep-epochs.ts` or as a documented admin-only query + notebook-style script,
  matching how this codebase treats other one-off analysis tooling) that:
  1. Pulls the per-epoch feature vectors the `/admin/oura-ble` debug dump already exposes
     (HR, movement, HRV, `hrVar`, `breathVar`, and the new signals once items 1/3 ship) across
     every night accumulated so far in `oura_raw_samples`.
  2. Runs a simple unsupervised fit — k-means (k=3, roughly deep/light/REM-ish clusters) or a
     Gaussian Mixture Model is enough; no need for anything heavier — over the z-scored feature
     vectors for "still, non-wake" epochs (the same candidate set `stageSleepDetailed` already
     isolates before its DEEP/REM decision).
  3. Reports the cluster centroids and, ideally, which of the current hand-picked cutoffs
     (`DEEP_Z`, `REM_Z`) they're consistent or inconsistent with — i.e. "does a natural 3-cluster
     split in the data agree with where the current thresholds are drawn, or does the data
     suggest they should move."
- This is diagnostic, not a replacement scoring function — the stager stays the interpretable,
  hand-authored z-score + Viterbi pipeline it is today (matches the project's stated preference
  for deterministic, explainable domain math over black-box math per the "One Formula, One
  Place" section of CLAUDE.md). The clustering result is *evidence* fed into the next manual
  constant change, the same way a redecoded night's debug dump already is.
- Sequence this **last** — it's most valuable once items 1 and 3 have added their signals (more
  dimensions for the clustering to actually separate on) and once more real nights have
  accumulated (unsupervised methods need more data than single-night eyeballing to be trustworthy).

**Honest limits:** without ground-truth labels, clustering can only reveal *structure* in the
data (does it naturally separate into groups, and does that line up with the current thresholds)
— it cannot prove which cluster is "real REM" versus "real light" on its own. Use it to sanity-
check and motivate threshold changes, cross-referenced against the owner's known Cloud-era
REM%/deep% baseline the same way every other change in this arc has been judged.

---

## Suggested sequencing

1. **Item 3 (SpO₂ variability)** — cheapest, decoder already exists, exact proven pattern to copy
   (`breathVar`).
2. **Item 1 (LF/HF HRV)** — reuses `breathing-rate.ts`'s resampling code, moderate new logic.
3. **Item 2 (ultradian prior)** — pure math, no new decoded signal, but touches the core scoring
   loop directly so should be its own isolated PR to keep it revertible.
4. **Item 4 (clustering fit)** — do last; benefits from items 1 and 3's new dimensions and from
   more accumulated real-night data.

Each item ships independently (own branch/PR off `main`, or sequential commits on
`feat/oura-ble-sleep-staging-phase1b` if done together in one implementer pass) — don't block
one on another completing first except where noted (item 4 on 1/3).

## Files map

| File | Role |
|---|---|
| `lib/health/sleep-staging.ts` | The stager — all four items' weights/terms land here |
| `lib/health/breathing-rate.ts` | Existing IBI-resampling code, reused/refactored for item 1 |
| `lib/health/hrv-frequency.ts` (new) | Item 1 — LF/HF ratio from resampled tachogram |
| `lib/oura-ble/spo2.ts` | Existing SpO₂ decoder — item 3 reads its per-epoch output |
| `lib/data/postgres/adapter.ts` (`aggregateOuraRawSamples`) | Bins raw samples into epochs — item 3's `spo2Var` binning goes here alongside existing `hrVar`/`breathVar` binning |
| `components/oura-ble/oura-ble-debug.tsx` | "Sleep epochs (debug)" — gains `lfHf`/`spo2Var` columns |
| `scripts/analyze-sleep-epochs.ts` (new) | Item 4 — offline clustering analysis tool |
| `lib/health/__tests__/sleep-staging.test.ts` | Extend for new terms, mechanics-only per existing convention |
| `docs/oura-ble-sleep-staging-findings.md` | Append results here once real nights are redecoded, same as every prior update in that doc |

## What this plan does NOT do

- Does not touch Phase 2 (SleepNet model extraction/inference) at all — fully independent track.
- Does not claim any of these four items will close the REM gap to Oura parity — they're
  legitimate additional signal/method upgrades, judged the same soft way (trend toward baseline
  on real redecoded nights) everything else in this arc has been judged, with the same explicit
  acknowledgment that only a trained model (Phase 2) can fully close it.
- Does not change the DEEP stage's decision path (untouched since session 236 per the owner's
  stated priority) — all four items only affect the REM/light boundary and its inputs.
