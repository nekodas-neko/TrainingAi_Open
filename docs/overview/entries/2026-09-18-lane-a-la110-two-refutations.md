# 2026-09-18 — LA-110: two candidates tested and refuted, and the mechanism named

**Branch:** `lane-a/la110-two-refutations` · **Lane A** · docs-only · no code, no migration ·
unversioned

The earlier entry today measured LA-110's window (09-07 → 09-12, five sessions, one set per exercise
instead of two) and listed three untested hypotheses rather than guessing. This tests two of them.
**Still no cause** — what changed is that the search space is smaller and two answers that looked
right are off it.

## Refuted — it was not a baseline block

This was the strongest candidate, because a baseline phase produces the observed signature **by
design**. `app/api/workout-data/route.ts:265`:

```ts
const aiPrescription = isAiDynamic && !isBaselinePhase && aiPeriodizationState?.prescription ? … : null
```

`isBaselinePhase` forces the prescription to null, and an AMRAP baseline is a single set with no
prescribed percentage — one set, no `planned_pct`, no style name. Exactly the fingerprint.

**Production says it did not happen.** Every `session_periodization` row carries
`baseline_complete = true`, and not one is in a `baseline` phase — across the window the phases are
`deload`, `realisation` and `accumulation`. `isAiDynamicBaseline` was false throughout.

## Refuted — it was not BF-148 (#1117)

It looks decisive at first: it landed **2026-09-12 10:31 AEST**, inside the window, and it is about
the very flag above. It runs **the wrong way**. BF-148 *removed* a name-keyed term that had been
**vetoing** the baseline, so its effect is to turn one-set/no-pct behaviour **on**. The data has that
behaviour *ending* around then.

Worth keeping as a refutation rather than dropping quietly: the date coincidence is strong enough
that the next reader will find it too, and the temptation is to stop there.

## The mechanism, which is now specific

The pct, the style and the set count all descend from `aiPrescription`, which is null whenever
`session_periodization.prescription` is absent; `buildWorkoutExercises` turns that into what the
screen shows.

**All five sessions transitioned into `accumulation` between 09-09 22:24 and 09-12 00:50 UTC**, and
their replacement prescriptions were generated **09-13 → 09-16** (`prescription_generated_at`). That
brackets the broken/clean boundary at the **end** of the window exactly.

**It does not explain 09-07 and 09-08**, which precede every one of those transitions. Whatever left
those two days unprescribed either started earlier or is a second cause. That is the remaining
question and it is now a narrow one.

## The limit that cost an hour, recorded so it costs nobody else one

**`session_periodization` stores only CURRENT state.** There is no history of `prescription`,
`prescription_status` or `phase`. `prescription_generated_at` and `phase_started_at` are the only
dated columns and they describe the row's *latest* values, not what it held on 09-08. The window
cannot be reconstructed by query; confirming the mechanism needs a reproduction or a log.

## Not exercised

- **The S25 device.** Docs only.
- **The third hypothesis.** The outbox replay path (`sync-helpers.ts:113` omits `progressionStyle`
  unless every set has planned fields) is consistent with the data and causally silent. Untested.
- **A reproduction.** Which is, per the limit above, what this now needs.
