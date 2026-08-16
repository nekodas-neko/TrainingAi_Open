# Plan: scale the measured warmup carve-out with the chosen session-length preset

**Status:** planned, not implemented. **Branch:** `fix/measured-warmup-scale-with-preset`.

## Problem

The owner picked "Quick" (30 min) on a Push session and got only 2 exercises (main + one
secondary), dropping all 3 accessories. The AI's own rationale text said "the strict 21-minute
time budget" while the header showed "~19 min of work" — both numbers are individually correct
(21 is the working-budget ceiling the trimmer targets, 19 is the actual estimate after trimming,
which is allowed to undershoot by design), but the *21* itself is the real question: the owner's
intuition was "warmup should be a % of session time, so a shorter session should carve out less
warmup" — and that's exactly what the code comment at `duration-model.ts:16-18` claims happens.

It only half-happens. There are two paths in `workingBudgetMin()` /
`warmupBudgetMin()` (`packages/shared/src/workout/duration-model.ts:36-53`):

1. **No measured data yet** (fewer than `WARMUP_LEARN_MIN_SESSIONS` = 8 completed sessions,
   `time-audit.ts:290`): warmup = `WARMUP_FRACTION` (15%) of the chosen budget. This scales
   correctly — Quick (30 min) carves 4.5 min, Long (90 min) carves 13.5 min.
2. **Measured data exists**: `buildMeasuredTimeBudget()` (`time-audit.ts:307-332`) learns a
   single median warmup **in absolute minutes** from the lifter's history (mostly logged at the
   session's *standard* length), clamps it to `[MIN_WARMUP_MIN=4, MAX_WARMUP_MIN=15]`
   (`duration-model.ts:30-31`), and that fixed number is subtracted from **whatever budget the
   preset produced** — `signals.ts:499-502` passes the preset-adjusted `budgetOverrideMin`
   straight into `workingBudgetMin()` alongside the measured warmup minutes, with no scaling by
   preset.

So once a lifter has real history (the common case after ~2 weeks), the same absolute warmup
carve-out (here, ~9 min) applies to every preset:

| Preset | Budget | Warmup carve | Working budget | % lost to warmup |
|---|---|---|---|---|
| Quick | 30 | 9 | 21 | 30% |
| Normal | 60 | 9 | 51 | 15% |
| Long | 90 | 9 | 81 | 10% |

The 15% figure only holds at the session's standard length by coincidence (the median was learned
from sessions run at roughly that length). A Quick session pays double the intended warmup tax,
which is why `dropToBudget()` (`packages/shared/src/ai-periodization/time-budget.ts:306-333`) has
to cut so hard — 3 of 5 exercises — to fit inside a working budget that's 30% smaller than the
"30 min minus 15%" the owner expected.

This is a real gap, not documented anywhere as intentional. It is separate from the (also real,
already-queued) weekly-volume-rebalance gap in `docs/implementation-backlog.md` — that one is
about *what happens after* exercises get dropped; this one is about *why so much gets dropped in
the first place*.

## Fix approach

Keep learning the absolute warmup median (it's still the best estimate of how long this lifter's
warmup actually takes in real minutes — warmup for typical strength work — walking to the gym,
joints, ramp sets — doesn't shrink linearly just because the *working* portion of the session is
shorter). The fix is not to make warmup itself scale with the preset; it's to stop double-charging
short sessions relative to the intended 15% baseline.

Two options, in order of preference:

1. **Cap the measured carve-out relative to the chosen budget, not just absolute minutes.**
   `warmupBudgetMin()` already clamps to `[MIN_WARMUP_MIN, MAX_WARMUP_MIN]`; add a third clamp —
   never take more than some ceiling fraction (e.g. `WARMUP_FRACTION * 2`, i.e. 30%) of the
   *chosen* budget, falling back toward the flat-fraction number as the preset shrinks. This keeps
   the measured value as the primary signal for Normal/Long (where it already tracks close to
   15%) while preventing Quick from being penalized twice — once by having less total time, once
   by an unscaled fixed carve-out.
2. **Simpler alternative:** when a `DurationPreset` other than `'standard'` is in play, don't use
   the measured warmup at all — fall back to the flat `WARMUP_FRACTION` path for `short`/`long`,
   and only use the measured median for `standard`. Cheaper to implement and reason about, but
   throws away real signal for Long sessions where the measured value is probably still more
   accurate than 15%.

Recommend option 1. It's a small, local change:

- `warmupBudgetMin()` (`duration-model.ts:36-41`): when a measured value is supplied, clamp it to
  `Math.min(MAX_WARMUP_MIN, Math.max(MIN_WARMUP_MIN, measured, totalBudgetMin * WARMUP_CEILING_FRACTION))` —
  actually the ceiling should be a **max**, not floor: `Math.min(measuredClamped, totalBudgetMin * WARMUP_CEILING_FRACTION)`
  isn't quite right either, since it would silently make a very short preset get almost no
  warmup. The right shape is closer to: use the measured value, but never let it exceed
  `WARMUP_FRACTION_CEILING * totalBudgetMin` (a value above 15%, e.g. 20-25%, chosen so Normal/Long
  are unaffected and Quick is bounded rather than left proportional to whatever the absolute
  median happens to be). This needs a concrete number picked and tested against real preset
  combinations before landing — that's an implementation task, not something to decide in this
  plan doc.
- Add a unit test in `packages/shared/src/workout/__tests__/duration-model.test.ts` (or wherever
  its sibling tests live) covering: measured warmup below the ceiling at all three presets
  (unchanged), measured warmup above the ceiling at Quick (clamped), Normal/Long unaffected by a
  9-min measured warmup.
- No DB/schema change, no sync/outbox implications (this is a pure read-time calculation used at
  prescription-generation time), no offline-first concerns.

## Verification

- `pnpm dev`, generate a Push prescription at Quick/Normal/Long for the seeded test user (who has
  enough logged history to trigger the measured path — check via `/api/admin/time-audit` or by
  looking at `warmupSec` in the generated prescription's debug output) and confirm the working
  budget no longer drops disproportionately at Quick.
- No device/native surface involved — this is server-side AI-periodization math, verifiable
  entirely in the sandbox.

## Task breakdown for the implementer session

1. Re-verify this plan against current `main` first — the measured-warmup/preset interaction
   could have moved since this was written.
2. Pick and justify a concrete ceiling fraction (or equivalent bound) in `duration-model.ts`.
3. Implement the clamp in `warmupBudgetMin()` / `workingBudgetMin()`.
4. Add/extend unit tests covering the three-preset matrix above.
5. Manually generate a prescription at all three presets in `pnpm dev` and confirm the ratio of
   warmup-to-budget stays roughly constant across presets instead of ballooning at Quick.
6. Journal entry + `projectOverview.md` update in the same PR, per the standard end-of-session
   rule.
