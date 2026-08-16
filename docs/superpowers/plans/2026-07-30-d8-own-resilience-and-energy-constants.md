# D8 — Own Resilience Weights & Own Workout-Energy MET Table (public-repo IP unblock)

**Date:** 2026-07-30 · **Type:** planning only (docs-only PR, per the backlog-driven convention — this
does not implement anything). **Read first:**
[`2026-07-21-oura-decoupling-and-own-models-strategy.md`](2026-07-21-oura-decoupling-and-own-models-strategy.md),
[`2026-07-21-oura-data-requirements-keep-cull-calculate-matrix.md`](2026-07-21-oura-data-requirements-keep-cull-calculate-matrix.md),
[`2026-07-21-oura-ondevice-hybrid-master-plan.md`](2026-07-21-oura-ondevice-hybrid-master-plan.md),
[`2026-07-27-d5-own-daytime-hrv.md`](2026-07-27-d5-own-daytime-hrv.md) — this plan is the next item
after D5/D6 in that sequence, driven by a new requirement those docs didn't have: **the codebase is
being prepared to go public**, which changes "temporary calibration oracle, delete in ~2-3 months" into
"must not ship at all in the public copy."

## Why this plan exists, and why it's narrower than it first looked

A same-session audit (triggered by the public-repo request) initially found `lib/oura-models/` +
`scripts/oura-models/` as a ~1,000-file, ~90MB tree of Oura's actual extracted proprietary model
weights, ONNX graphs, decompiled Python source, and golden test vectors — real trade-secret exposure,
not just "reverse-engineered protocol." Cross-checking against the existing 2026-07-21 matrix and this
session's own import-graph audit narrows it to two concrete, mechanical gaps — not "replace 8 models":

- **6 of the 8 TS ports in `lib/oura-models/*.ts`** (`cumulative-stress`, `daily-baselines`,
  `meal-timing`, `astd-event-detection`, `steps-motion-decoder`, `sleepnet-assemble`) are confirmed
  **dormant — no live consumer anywhere in the app** (per the matrix's own "⚠ produced, UNCONSUMED" /
  "library port only" notes and this session's `grep` of every import site). These need no replacement
  work at all; see Task 3.
- **D5 already retired the one ONNX dependency the matrix flagged for resilience** ("Resilience …
  its input uses dHRV ONNX … Own (dHRV = oracle, replace)", matrix row 11) — `daytime-stress.ts` no
  longer calls the dHRV ONNX model in production. That leaves exactly **one** remaining IP dependency
  for resilience, and it's not an ONNX call at all:

The two real gaps, confirmed by import-graph audit this session:

1. **`lib/health/stress-resilience.ts:7`** — `import { getResilienceConstants } from '@/lib/oura-models/constants'`.
   The banding/scoring code itself is hand-written arithmetic (correctly called "Own"/"deterministic
   port" by the matrix), but the actual numeric weights and thresholds it plugs in are Oura's own
   extracted, tuned parameters for `stress_resilience_2_2_1`. **"Deterministic port" and "IP-clean" are
   different axes** — the matrix's "Own" column tracked runtime/cloud decoupling, not constant
   provenance, and this is the gap that axis didn't surface.
2. **`lib/health/workout-energy.ts:15`** — `import featureSpec from '@/lib/oura-models/constants/energy-expenditure-features.json'`,
   Oura's extracted 82-activity MET lookup table. The rest of the formula (Schofield BMR, RPE→intensity
   mapping) is already independently authored and untouched.

Once these two imports are gone, **`lib/oura-models/constants` (and by extension the whole
`lib/oura-models/`/`scripts/oura-models/` tree) has zero live consumers anywhere in the app** — it drops
straight from "IP risk" to "unused, deletable" (Task 3), no stubbing or partial-repo tricks needed.

## Non-goals

- **Not re-litigating SleepNet / step_counter.** The 2026-07-21 strategy deliberately decided to keep
  these two forever (our own heuristic is measurably worse, no independent ground truth for sleep
  stages). That call stands on its physiological merits. But it now has a consequence that doc didn't
  anticipate — see **Open decision** below. This plan does not resolve that; it flags it so it isn't
  silently decided by omission.
- **Not re-doing D5** (dHRV) — already shipped, already excluded from this plan's scope.
- **Not porting the 6 dormant models to anywhere new.** No live surface needs them; if a future feature
  wants chronic-stress-cluster-style scoring or ML-grade sleep staging, that gets planned fresh and
  independently, not resurrected from the vendored ports.

## Task 1 — Own resilience weights

- First step for the implementer: read `getResilienceConstants()`'s actual shape
  (`stress_resilience_2_2_1.constants.json` via `lib/oura-models/constants/index.ts`) and
  `runStressResilience` in full to enumerate exactly which thresholds/weights/band-cutoffs are consumed
  — this plan intentionally doesn't pre-guess that shape.
- **Approach:** re-derive an equivalent composite from first principles using inputs the app already
  owns independently — sleep-recovery quality (`sleep-score.ts`), daytime-stress load
  (`daytime-stress.ts`, now dHRV-free per D5), HRV trend — combined into a documented weighted
  composite/z-score, banded into the existing 5 levels via percentile cutoffs fit on our own data (not
  copied from Oura's constants file).
- **Calibration, not cloning:** register a new adapter on the existing
  `lib/oura-comparison-harness.ts` (the D6 harness — reference-pluggable by design, no core changes
  needed): `ours()` = our new resilience score per day, `reference()` = `oura_daily.resilienceLevel`
  (already fetched via Oura's official Cloud API in `app/api/oura/sync/route.ts` — using their
  **published output** as a benchmark is fine; it's their extracted **weights** that are the problem,
  not comparing against a number their app shows you). Follow the 2026-07-21 doc's own "tripwire, not
  sameness" rule (§4): tune until in-the-right-ballpark and physiologically sane, not to minimize the
  gap to zero — optimizing to zero just clones Oura's model by another route.
- **Persistence unchanged:** still writes `oura_daily_derived.resilience_*` — this is a formula-source
  swap, not a schema change.

## Task 2 — Own workout-energy MET table

- Smaller, mechanical: replace `energy-expenditure-features.json` with our own MET-value table sourced
  from the public **Compendium of Physical Activities** (Ainsworth et al. — an independent academic
  reference, not extracted from Oura), keyed to the same activity IDs `lib/health/workout-activities.ts`
  already uses. Everything else in `workout-energy.ts` (Schofield BMR, RPE intensity mapper) is already
  independent and stays as-is.
- Calibrate the resulting per-workout kcal against Oura's own daily/activity calorie fields (already
  synced via `oura/sync/route.ts`) the same way — same harness pattern, tune only if grossly off.

## Task 3 — Retire the vendored tree

Once Tasks 1–2 land and are verified (grep confirms nothing outside `lib/oura-models/` imports from
it), delete in one PR: `lib/oura-models/`, `scripts/oura-models/`, `.agents/skills/oura-models/`,
`docs/oura-models-inventory.md`, `docs/oura-models-bundle.md`, and the orphaned
`docs/preserve-pt-originals-and-goldens` backup branch on `origin` (holds the raw `.pt` originals,
unmerged, should be deleted regardless of repo visibility). This is now a plain dead-code cleanup, not
a "hide it from public" maneuver — nothing in the live app will reference any of it.

## Open decision needed from the owner — SleepNet & step_counter

The 2026-07-21 master plan's own considered, adversarially-reviewed call was to **keep these two
forever**:
- Sleep-stage hypnogram → `sleepnet_moonstone_1_2_0` (SleepNet)
- Step counting → `step_counter_1_3_0`

That decision predates the "go public" goal. A permanent dependency is the opposite of what Tasks 1–2
achieve for resilience/energy, and it means these two specific vendored files can **never** ship in a
public/open copy of the app — not "for now," permanently, under that decision. Three ways forward,
needs an explicit call before Track A's public-repo cut is finalized for these two features specifically:

1. **Accept a permanently worse sleep-stage/step estimate** in whatever repo becomes primary — i.e.
   revisit the 2026-07-21 tradeoff now that "must be public-safe" outweighs "must match Oura's accuracy."
2. **Keep only these two files private** — a small private companion module the public repo never
   contains, permanently, while everything else (post D8) is public-clean. The public/open codebase is
   then permanently missing full parity for just these two features.
3. Something else — flag if there's a third option in mind (e.g. a licensed/purchased alternative sleep
   staging model).

This plan takes no position — it surfaces the conflict Tasks 1–2 don't resolve.

## Sequencing vs. the public-repo migration (Track A) — UPDATED 2026-07-30, now gated on Phase 3

**Owner decision (2026-07-30): the public-repo release does not happen yet.** It is sequenced to start
only after **Phase 3 of the native-feel roadmap ships** (`docs/superpowers/plans/2026-07-28-native-feel-roadmap.md`
Q-1 in the backlog — "bundle the shell into the APK," the app-native end-state where there is **no
Railway server deploy** and Postgres is demoted to sync/redundancy only). This changes the earlier plan
in one important way:

**Why Phase 3 changes the SleepNet/step_counter answer.** With no public server deploy cloning a fresh
checkout to build+serve the app, the two permanently-kept vendored models (SleepNet, `step_counter` — see
the 2026-07-21 strategy doc's "keep forever" call) don't need private-bucket-plus-build-step
infrastructure at all. They can simply be **gitignored** — removed from git tracking, kept only as local
files wherever the actual APK build happens (the owner's own build machine/private CI). The public repo
ships the loader/inference *code* (generic, not proprietary) but never the weight/constant files
themselves, and never any comments/docs describing their provenance (extraction source, sha256 tied to
Oura's binaries, etc.) — those get stripped regardless of the gitignore trick. Nobody but the owner is
expected to get a fully-working build of those two features from a public clone, which is fine since
nobody else is deploying this app.

**This does NOT change Tasks 1–3 above** — resilience and workout-energy still get genuinely replaced
(not gitignored) since those are live, "public repo should demonstrate a real, working feature" cases,
not "we're the only ones who'll ever build this" cases. The gitignore treatment is specific to
SleepNet/step_counter only.

**Revised sequencing:**
1. Phase 3 (bundle shell into APK) ships first — separate, already-scoped project, not part of this plan.
2. A DB cleanup happens aligned with that transition (Postgres now serving as sync/redundancy only) —
   see the owner's 2026-07-30 note; needs its own investigation/plan given the `body_hex`
   never-prune rule (CLAUDE.md, Oura Direct-BLE section) likely conflicts with straightforward deletion.
3. Only then: Tasks 1–2 (own resilience/energy constants) land, the vendored tree is deleted (Task 3)
   except SleepNet/`step_counter`'s asset files which move to `.gitignore` instead of deletion, and the
   public repo is cut as a fresh, history-free snapshot per the earlier discussion (exclude the vendored
   tree wholesale except the two gitignored files which are simply absent from any commit, rewrite the
   BLE docs, fix the hardcoded email in migration 006).

## Backlog entry

Added to `docs/implementation-backlog.md` (see queue) pointing at this plan, branch
`feat/d8-own-resilience-energy-constants`.
