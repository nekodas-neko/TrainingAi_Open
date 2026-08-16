# Juggernaut Wave Progression — a third, deterministic block-periodization mode

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:writing-plans /
> superpowers:executing-plans to turn this into a task-by-task build when picked up.
>
> **Re-verify before building (this plan will go stale sitting in the queue):** this doc
> was written from a point-in-time read of `lib/data/postgres/schema.ts` (the `programs`,
> `phaseSets`, `programPhases`, `progressionStyles`/`styleSets`, `sessionPeriodization`
> tables) and `lib/workout/session-data.ts` (`basis = max(lastLog.estimated1rm, PR)`).
> Confirm those shapes and line references still hold against current `main` before
> implementing — schema/route churn here is frequent (see `docs/module-map.md`).
> No code has been written for this yet; this is a design + mechanics reference only.

## Goal

Add "Juggernaut Wave" as a new, **third** `phaseMode` on `programs` — alongside the
existing `manual` (flat static progression style) and `ai_dynamic` (LLM-generated,
soreness/readiness-reactive prescription). It implements the classic Juggernaut Method
(Chad Wesley Smith) 16-week block cycle: four "rep waves" (10/8/5/3 reps), each a
4-week block of Accumulation → Intensification → Realization → Deload phases, with a
**per-lift training max that is locked for the whole 4-week block** and only bumped
once, at the end of the block's Realization-phase AMAP (max-reps) test, via a fixed
formula. This is deliberately **not** a variant of `ai_dynamic` — no AI, no daily
soreness/readiness reactivity, no autoregulation. It's a rigid, pre-planned cycle, same
philosophy as `manual`, just with a smarter block-boundary progression rule than a flat
static style has today.

**Why a new mode and not a tweak to `ai_dynamic`:** confirmed with the owner
(2026-07-20 conversation) — `ai_dynamic`'s adaptive, reactive model is solving a
different problem than Juggernaut's fixed plan, and grafting a locked-block formula
onto it would only constrain the AI system for no benefit. Nothing from this plan
should touch `ai_dynamic` or `sessionPeriodization`.

## Non-goals

- Not touching `manual` or `ai_dynamic` phase modes, their routes, or their tests.
- Not building a program-import/wizard flow for arbitrary user-uploaded spreadsheets —
  this is one named, built-in template style, not a generic spreadsheet importer.
- Not attempting to reproduce every cosmetic label from the source sheet ("2-3 reps shy
  of failure", "1-2 reps shy of failure") as literal UI copy — those are RPE cues that
  should probably render as the app's existing RPE/effort language, not verbatim text.
- Not deciding unit conversion as gospel here — see Open Decision 1 below.

---

## The source mechanics (verified against the actual spreadsheet, not from memory)

Read via a real `xlsx` export of the user's Google Sheet (formulas + cached values, not
just a rendered summary). All of the below is exact.

### 1. Training max seed

```
TM = CEILING(1RM_input × 0.9, 5)
```
90% of a true or estimated 1RM, rounded **up** to the nearest 5 lb.

### 2. Every prescribed set weight

```
Weight = CEILING(TM × pct, 5)
```
Every single set in the 16-week template is just the block's locked TM times a
percentage, ceiling-rounded to the nearest 5 lb. No other math anywhere in the body of
the sheet.

### 3. The 4-wave × 4-phase structure

Four "rep waves" run back to back, each a 4-week block against its own locked TM:

| Wave | Weeks | Accumulation reps | Intensification reps | Realization top reps | Deload |
|---|---|---|---|---|---|
| 10-rep | 1–4 | 10 | 5 / 5 / 10 / 10+ | 5,3,1,AMAP | 5/5/5 |
| 8-rep | 5–8 | 8 | 3 / 3 / 8 / 8+ | 5,3,2,1,AMAP | 5/5/5 |
| 5-rep | 9–12 | 5 | 2 / 2 / 5 / 5+ | 5,3,2,1,1,AMAP | 5/5/5 |
| 3-rep | 13–16 | 3 | 1 / 1 / 3 / 3+ | 5,3,2,1,1,1,AMAP | 5/5/5 |

Per-phase percentage tables (constant across all 4 lifts within a wave — only the TM
they're multiplied against differs per lift):

**Accumulation** (flat %, 5 sets, wave's rep count each): 10s→60%, 8s→65%, 5s→70%, 3s→75%.
Last set cue: "2–3 reps shy of failure."

**Intensification** (ramping %, reps step down, 4–5 sets): e.g. 10-rep wave's
Intensification is 55/62.5/67.5/67.5% × 5/5/10/10 reps. Each wave follows the same
shape — a flat/ramp warm-up followed by 2 back-to-back top sets at the wave's highest %
for that phase. Last set cue: "1–2 reps shy of failure."

**Realization** (ramping % up to 70–90%, reps stepping down to 1, final set = AMAP
"Failure" test): the number of ramp sets **grows as the wave shortens** — 4 sets for the
10-rep wave, 5 for the 8-rep wave, 6 for the 5-rep wave, 7 for the 3-rep wave — always
ending on a true AMAP top set. Top-set % also rises per wave: 75% → 80% → 85% → 90%.

**Deload** (identical shape every wave): flat 40/50/60% × 5 reps, always exactly 3 sets.

Full per-lift, per-set %/rep grid (all 4 waves, all 4 lifts) is preserved in this
session's scratchpad dump if needed — regenerate via the export commands in "How this
data was extracted" below rather than trusting transcription here for exact percentages
below the 2nd decimal; the ratios and shapes above are the load-bearing facts.

### 4. The block-boundary training-max bump (the actual "Juggernaut logic")

At the end of each wave's Realization phase, after the AMAP top-set is performed:

```
TM_new = CEILING(TM_old + (AMAP_reps − rep_standard) × increment, 5)
```

- `rep_standard` = the wave's rep count (10, 8, 5, or 3) — the number the AMAP set is
  judged against, not the number actually performed.
- `increment` = **2.5 lb** for Bench Press and Overhead Press (upper-body press
  movements), **5 lb** for Squat and Deadlift (lower-body/hinge movements).

So every rep beyond the wave's rep-standard on the AMAP test banks a fixed weight
increase toward the *next* wave's TM — upper-body lifts progress at half the rate of
lower-body lifts. This is the one piece of real "logic" in the whole sheet; everything
else is percentage arithmetic.

### How this data was extracted

`curl -sL -o file.xlsx "https://docs.google.com/spreadsheets/d/<id>/export?format=xlsx"`,
then `openpyxl.load_workbook(path, data_only=False)` for formula strings and
`data_only=True` for cached values, dumped cell-by-cell. Do this again if the exact
per-set percentage table needs re-verifying — don't trust a WebFetch summary (it goes
through a small summarizer model and drops formulas).

---

## Mapping onto TrainingAI's existing infrastructure

Checked against current `main` (`lib/data/postgres/schema.ts`):

**Already reusable, no schema change needed for this part:**
- `programs.phaseMode` is already a 3-way enum in `lib/types/program.ts`
  (`'manual' | 'automatic' | 'ai_dynamic'`) — DB column default is `'manual'` (text, not
  a real enum, so adding a 4th value like `'wave'` is a data-only change, no migration).
- The **`automatic`** mode's existing infra is almost exactly what the wave/phase
  rotation needs: `phaseSets` (a named, reusable set of phases) → `programPhases`
  (`position`, `durationCycles`, `phaseType`, `primaryStyleId`/`secondaryStyleId` →
  `progressionStyles`) already models "a sequence of named phases, each some number of
  cycles long, each pointing at a progression style." The 16 Juggernaut phases (4 waves
  × 4 phase-types) are 16 `programPhases` rows, each `durationCycles: 1`, each pointing
  at its own `progressionStyles`/`styleSets` row built from the %/rep table above. This
  part may need **zero new schema** — just new data (a phase-set template) plus
  whatever `automatic` mode already does to walk `programPhases` in order.
- `progressionStyles`/`styleSets` (`{pct, reps, restSec, useFor1rm}` per set) already
  matches the shape of one phase's per-set table exactly. `useFor1rm` already exists as
  a boolean flag on a set — the natural place to mark the Realization phase's final AMAP
  set (today `useFor1rm` feeds the *rolling* 1RM estimate; see next point for why that's
  not quite sufficient here).

**Genuinely new, not covered today:**
- Every existing mode (`manual`, `automatic`, `ai_dynamic`) computes a set's target
  weight against a **continuously-updating rolling basis**:
  `basis = max(lastLoggedExercise.estimated1rm, allTimePersonalRecord)`
  (`lib/workout/session-data.ts`, confirmed by reading — updates after *every* logged
  AMRAP set, Epley-derived via `lib/1rm.ts`). Juggernaut instead needs a **training max
  locked for an entire 4-week block**, that only moves **once**, at block end, by the
  fixed reps-over-standard formula above — not the continuous Epley re-estimate. These
  are two different progression philosophies and neither should be quietly blended into
  the other (see "One Formula, One Place" in `CLAUDE.md` — this is a genuinely
  *different* formula, not a duplicate of the existing 1RM one).
- Something has to: (a) store the per-lift locked TM for the program's current wave,
  (b) detect "the Realization AMAP set for lift X in the current wave was just logged"
  and read its actual rep count, (c) apply the fixed-increment bump to produce next
  wave's TM, (d) re-derive that wave's `progressionStyles`/`styleSets` percentages
  against the new TM (or, more likely, keep the *style* as pure percentages and store
  the TM separately, multiplying at render time the same way `manual` multiplies
  against `basis` today — this is probably the cleaner design, since it reuses the
  existing set-rendering path instead of rewriting stored style rows every 4 weeks).
- Nothing today keys a "lift" independent of a specific `session_exercises` row the way
  Juggernaut needs (TM is per *lift* — Bench/Squat/Press/Deadlift — used across
  whichever sessions/exercises reference it that wave). Needs a small new concept: a
  per-program, per-exercise (or per-exercise-name) "block training max" value.

---

## Open decisions for whoever implements this

1. **Unit conversion (lb → kg).** The whole app is kg-native (`weight_kg` columns,
   `mround125Up` — ceiling to nearest 1.25 kg — already exists in
   `components/workout/utils.ts` as the exact functional analogue of the sheet's
   `CEILING(x, 5lb)`). Recommend **not** a literal lb→kg conversion of "5 lb" /
   "2.5 lb" — instead re-express the *relative* proportion in the app's native plate
   vocabulary: lower-body/hinge lifts (Squat, Deadlift) bump **+2.5 kg** per rep over
   standard, upper-body press lifts (Bench, OH Press) bump **+1.25 kg** — i.e. reuse
   `mroundStepUp`'s existing 2.5 kg / 1.25 kg plate increments rather than inventing a
   new rounding step. Confirm with the owner before building, since this is a
   real behavior decision, not just arithmetic.
2. **Where "increment = 2.5 vs 5" is keyed.** The source sheet hardcodes it by exercise
   name (Bench/Press vs Squat/Deadlift). This app never hardcodes lift identity (see
   CLAUDE.md's "No Hardcoded Session Names" rule, which is about sessions but the same
   principle applies to exercises) — so this needs to be a per-exercise **field**
   (e.g. `progressionIncrementKg` on `exercise_library`, or scoped to the phase-set
   template's exercise mapping), defaulted sensibly, not an `if (name === 'Bench')`
   anywhere in code.
3. **How the AMAP rep count is captured.** The natural mechanism is the existing
   `useFor1rm` flag on the Realization phase's last `styleSet` — when that set is
   logged, its actual `reps` (from `set_logs`) is the AMAP performance. Confirm this can
   drive the block-bump calculation without conflicting with `useFor1rm`'s existing
   rolling-1RM-feed behavior (may need a second flag, e.g. `useForBlockMax`, if the two
   consumers shouldn't share one boolean).
4. **Wave transition trigger.** `automatic` mode's existing phase-advance mechanism
   (whatever currently walks `programPhases` by `durationCycles`/session count) should
   be reused for advancing through the 16 phases — re-verify it also gives us a clean
   hook to fire the TM-bump calculation specifically at Realization→Deload phase
   boundaries (once per wave, not once per phase).
5. **Program-builder UI.** Does this need a first-class "Create Juggernaut Wave
   program" wizard entry (like the existing program wizard), or is it enough to ship it
   as a selectable built-in phase-set template within the existing `automatic`-mode
   program editor? Recommend the latter for v1 — smaller surface, reuses
   `program-editor-sheet.tsx`'s existing phase-set picker if one exists.

## Suggested high-level task shape (for the implementer to break down further)

1. Re-verify the `automatic`/`programPhases`/`phaseSets` mechanics against current
   `main` (this is the riskiest assumption in this plan — confirm phase advancement,
   `sessionsInPhase`-equivalent tracking, and how `primaryStyleId`/`secondaryStyleId`
   currently resolve to a rendered set weight).
2. Resolve Open Decisions 1–5 above (short conversation with the owner, not a big
   design doc).
3. Add the per-exercise/per-program locked-TM storage (schema/migration).
4. Build the 16-phase `phaseSets`/`programPhases`/`progressionStyles` template data
   (seed script or admin-console generator, not hand-entered per user).
5. Implement the block-boundary bump: detect the AMAP set's log, compute
   `TM_new`, store it, and ensure the *next* wave's set-weight rendering picks it up
   (likely: the existing `basis`-multiplication path in `session-data.ts`, gated on
   `phaseMode === 'wave'` reading the locked TM instead of the rolling Epley basis).
5. Tests: the bump formula (round-trips against the spreadsheet's own worked
   examples — e.g. Bench TM 85 → AMAP 16 reps @ rep-standard 10 → new TM 100, verified
   against the actual sheet's `New Training Max Calculator` section), and the
   percentage-table generation for at least one full wave.
6. Full gate (lint/tsc/tests/build) + local `pnpm dev` smoke of a seeded Juggernaut
   program through one full wave (4 weeks) before considering this shippable.
7. On-device verification is **not** expected to be required for this — it's pure
   server-side prescription math + existing UI components, no native/safe-area/gesture
   surface — but confirm that holds once the actual diff is known.

Not estimating effort here — genuinely depends how much of `automatic` mode's phase
machinery turns out to be directly reusable vs needing extension.
