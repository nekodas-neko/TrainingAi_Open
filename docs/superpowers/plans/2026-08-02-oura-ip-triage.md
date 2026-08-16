# Plan — Oura-IP triage: what to replace, what to gitignore, what to delete

_Created 2026-08-02. Re-scopes backlog **Q-31**, whose stated premise ("two live imports") is
false. Docs-only: this decides and sequences, it does not swap anything. Owner escalation
2026-08-02: *"This is a big one — we need to figure out fast how we will do this in the future; or
how we will obscure this part from our public github repo when we move to it."*_

**Branch for this plan:** `docs/oura-ip-triage-plan` · **Implementation branches:** one per row below.

---

## The import graph, audited against `main` on 2026-08-02

Q-31 claims two live imports of Oura's extracted constants and that everything else in
`lib/oura-models/` is "confirmed dormant". A fresh `grep` over `lib/ app/ components/ packages/`
finds **seven live** and **one genuinely dormant** — the dormant one is not among the two it names.

| # | Module | Oura IP | Live importers | Reaches |
|---|---|---|---|---|
| 1 | `constants` → `getResilienceConstants()` | `stress_resilience_2_2_1` | `lib/health/stress-resilience.ts` | Readiness surface (own resilience band) |
| 2 | `constants/energy-expenditure-features.json` | 82-activity MET table | `packages/shared/src/health/workout-energy.ts` → `daily-energy.ts` | Energy Budget, per-workout kcal |
| 3 | `inference/ots` | `training_stress_score_0_2_1` | `packages/shared/src/health/training-stress.ts` | `training-stress-line.tsx`, `training-stress-badge.tsx`, `done-screen.tsx` — **user-visible** |
| 4 | `steps-motion-decoder` | `steps_motion_decoder_2_0_0` dequant tables | `cadence-tracker.ts`, `auto-detection-service.ts`, `step-counter-pipeline.ts` | Steps, cadence, activity auto-detection |
| 5 | `sleepnet-assemble` | `sleepnet_moonstone_1_2_0_core.onnx` (8.0 MB) | `adapter.ts` (`sleepNetStages5Min`), `repository.ts` | The hypnogram |
| 6 | `inference/step-counter` | `step_counter_1_3_0_core.onnx` (343 KB) + `.pt` constants | `step-counter-pipeline.ts` | Daily steps |
| 7 | `cumulative-stress` | `cumulative_stress_1_2_2` tensors | `packages/shared/src/health/chronic-stress-assembly.ts` → `adapter.ts` | `oura_daily_derived.chronic_stress_score`, synced to device |
| — | `inference/dhrv` | `dhrv_imputation_1_1_0.onnx` (19 KB) | **none reachable** — see below | — |

**Also carried, not imported:** several modules are *ported logic* with Oura source cited in
comments rather than a constants import — `packages/shared/src/health/hrv-5min.ts`,
`sleepnet-preprocess.ts`, `lib/oura-ble/step-features.ts`, and the whole `lib/oura-ble/decode.ts`
protocol port. These are a **separate legal question** from vendored numeric constants and model
weights, and this plan does not resolve them. Flag for the owner; do not assume the answer is the
same.

**Assets on disk:** `lib/oura-models/onnx/` is **31 MB**, `lib/oura-models/constants/` **12 MB**.
The three SleepNet/BDI files alone are 20.7 MB.

### The one deletion available today

⚠️ **Corrected 2026-08-02 (Q-49 A0):** `inference/dhrv` is *production*-unreachable, but calling it
"dead" and deleting it would drop a **deliberate** retention — `docs/module-map.md` and
`docs/oura-ondevice-hybrid-implementer-progress.md` both record that the ONNX path "stays
golden-tested but unreachable from production **until D7**". That golden test is what pins our own
D5 regression against Oura's original. Removing it is a D7 decision, not a sweep.

`computeDaytimeStress` (the ONNX path) is called only by
`buildDaytimeStressSeries`, and **`buildDaytimeStressSeries` has no caller** — both production sites
(`adapter.ts`, `app/api/body-battery/route.ts`) use `buildDaytimeStressSeriesFromModel`, D5's own
fitted regression. Deleting the import, the ONNX file and the dead functions removes one Oura
dependency at zero product cost. It is the cheapest row here and should ship first, because it also
*proves the audit method* on a low-risk module.

---

## Triage decisions

The owner's steer: replace over time with our own maths or public sources; gitignore what is still
in use until replaced; case by case. Three verdicts.

### REPLACE — a public or first-principles substitute exists

**Row 2, the MET table — replace first, and it is nearly free.** `daily-energy.ts:13` already
documents the source as *"Compendium of Physical Activities (Ainsworth et al.)"*. The Compendium is
a published, citable reference; Oura's table is a pinned copy of it keyed by their own activity
ids. So this is not "derive our own MET values" — it is **re-source the same numbers from the
public Compendium and re-key them to our `activityType` strings**, dropping
`energy-expenditure-features.json`. The risk is a value-by-value diff, not a modelling exercise.

**Row 3, training stress — replace second.** Session load from duration × intensity is
well-trodden sports science (Banister TRIMP, Foster session-RPE). We already store session RPE and
HR, and `computeVolumeAcwr` is ours. A defensible own formula is reachable, and the D6 comparison
harness (`lib/oura-comparison-harness.ts`) can calibrate it against Oura's Cloud scores without
copying constants. **User-visible**, so it needs a before/after on the owner's own history, not just
unit tests.

**Row 1, resilience — replace third.** `stress_resilience_2_2_1` is a weighted assembly over
signals we already compute. Same calibrate-don't-copy approach. Lower urgency: one band on one
screen.

### GITIGNORE — in use, no substitute worth building yet

**Rows 5 and 6 — SleepNet and `step_counter`.** Both are neural weights; there is no public
equivalent, and replacing them is a research project. Keep them, exclude the asset files from the
public repo, and load them from the owner's private build machine.

Two things this must not gloss over:

- **Excluding a file from a *new* repo is easy; excluding it from *history* is not.** If the public
  repo is a fresh init (which Q-32's "cut the public repo" framing implies), `.gitignore` suffices.
  If it is ever a push of *this* repo's history, the assets are in every prior commit and
  `.gitignore` does nothing. **Decide which it is before writing any `.gitignore` line** — this is
  the single question that decides whether gitignore is a real strategy or a false comfort.
- **A gitignored model must fail loudly, not silently.** If the weights are absent, the hypnogram
  and step count must show an explicit unavailable state, never a fabricated one. Health Connect
  already supplies sleep stages and steps for non-Oura users (see
  [`device-agnostic-source-architecture.md`](../../device-agnostic-source-architecture.md) §C1), so
  a clean fallback exists — wire it as part of the gitignore work, not after.

### DELETE — dormant

**Row 8, `inference/dhrv`**, plus any other `lib/oura-models/` file with no importer. The audit
above only enumerated *live* imports; a full sweep of the tree (60+ constants files, 10 ONNX
files) will find more dormant ones. **That sweep is itself a task** — see Task 0.

### Row 4 and row 7 — decide, don't default

**Row 4, `steps-motion-decoder` — ✅ DECIDED 2026-08-02: gitignore.** Owner: *"For now this should
be hidden. as gitignore. We just want to point our model at the decoded data (as another device
would give that anyways)."* So it joins rows 5 and 6 in the gitignore group rather than the
replace group. The reasoning is worth keeping: what we actually consume is *decoded step data*,
which any other device supplies through Health Connect regardless — so the decoder is an input
adapter for one device, not something the app's model depends on. That also means it is a
**replace-later** candidate rather than a permanent keep, on the same footing as SleepNet.

**Row 7, `cumulative-stress`,** writes a column that is synced to the device. Replacing it changes
stored history, so it needs a migration story (recompute vs leave old rows). Sequence it last of
the replaceables, or gitignore it in the interim.

---

## Tasks

**Task 0 — full dormancy sweep (do this before anything else).** Script an importer check over
every file in `lib/oura-models/`, list the unreferenced ones, and delete them in one PR. This
shrinks the surface every later row has to reason about, and it is pure subtraction. Include
`inference/dhrv` and its 19 KB ONNX. Assert the sweep in a test so the tree cannot silently
re-accumulate dead vendored files.

**Task 1 — ~~resolve the fresh-repo-vs-history question~~ ✅ ANSWERED 2026-08-02: fresh repo.** The
owner is creating a brand-new GitHub repo, which is a fresh `git init` — no history is carried
over, so none of the 43 MB of model assets in this repo's past commits reaches it. `.gitignore` is
therefore a real strategy and rows 5 and 6 are unblocked.

*(For the record, since the owner asked what the difference is: a new empty GitHub repo that you
push a fresh `git init` into contains only the commits you make from that point. Pushing **this**
repo's history to it would carry every past commit, and a file deleted today still sits in the
commits before the deletion — which is why the distinction mattered here.)*

**Task 2 — replace the MET table from the public Compendium** (row 2). Diff every value; a
mismatch is a finding, not a rounding difference.

**Task 3 — replace training stress** (row 3), calibrated via the D6 harness. Before/after on the
owner's real history.

**Task 4 — ~~owner decision on row 4~~ ✅ done: gitignore (see above).**

**Task 5 — replace resilience** (row 1), then **Task 6 — cumulative stress** (row 7) with its
migration story.

Rows 5 and 6 stay gitignore-only until someone chooses to fund the research.

---

## What this plan deliberately does not do

- **No constants are swapped here.** Q-31's *implementation* stays blocked behind Q-1 and Q-30, per
  the owner's 2026-07-30 sequencing. Only the thinking is unblocked.
- **It does not resolve the ported-logic question** (decoders, preprocessing, feature extractors
  written from Oura's source rather than importing its numbers). That is a distinct question and
  arguably the larger one, since `lib/oura-ble/decode.ts` is the whole BLE protocol.
- **It does not estimate legal risk.** Every verdict above is an engineering judgement about
  substitutability and cost. Whether a pinned public MET table or a ported decoder is *safe to
  publish* is the owner's call, and Task 1 is where that conversation starts.
