# 2026-08-24 — autoregulation's missing-data defaults now agree on both paths (Q-299)

**Branch:** `claude/implementation-lane-a-setup-p3f5zk` · **Lane A** · no migration, no APK.

`repCompletionRate` is null on ~83% of sets (`planned_reps` is recorded on only 176 of 1,009).
`autoregulation.ts` read that null asymmetrically: the back-off path's `missedReps` defaulted to
`false` (absence read as "not proven missed"), but the push path's `metReps` defaulted to `true`
via `(repCompletionRate ?? 1) >= 1` (absence read as "a completed set"). Missing evidence removed a
condition from the load-increase path and left the decrease path unhelped — the two paths
disagreed about what "we don't know" means.

## What shipped

`metReps` is now `sig.repCompletionRate != null && sig.repCompletionRate >= 1` — the same
null-handling shape `missedReps` already used one line above it. Missing data now blocks the push
path (can't substantiate that reps were met) the same way it already declined to trigger the
back-off path on its own (can't substantiate that reps were missed). The back-off path's
independent `rm1Trend === 'down'` branch is untouched — a regressing lift still triggers a cut with
no rep-completion data needed, exactly as before.

## Why this didn't wait for the owner

The entry offered two options — block autoregulation entirely without prescription data, or treat
null as neutral on both paths — and framed the decision as needing to be made deliberately. Both
options agree on the thing that actually matters: the *asymmetric* status quo (optimistic on the
side that adds load) was wrong regardless of which symmetric replacement is chosen. The fix applied
is the more conservative of the two named options (no push without evidence), it's a five-line code
change with a clean revert path, and it touches no migration or stored data — squarely in the
"cheap and reversible, I decide and say why" category CLAUDE.md's decision-brief rule carves out,
rather than the "genuine preference, ask first" category.

## What's still open

Split off as **Q-299b**: why 83% of sets carry no `planned_reps` at all. This fix makes the
missing-data case *safe*; it doesn't make the data present, and finding the root cause (sets logged
outside a prescribed session? a write path dropping the planned fields?) is a separate, larger
investigation.

## Verified

- New test: `does not push when completion is unknown` — asserts a `NONE` adjustment for a low RPE
  delta + rising 1RM + null completion, which previously pushed reps on RPE alone.
- Existing 32 tests in `autoregulation.test.ts` still pass unmodified (none locked in the old
  push-on-null behaviour).
- `generate-prescription.ts` is the only other caller of `computeRpeAdjustment`/
  `applyAutoregulation`; it has no dedicated test file, and its indirect exercisers
  (`regenerate-in-background.test.ts`, `reconcile-counters.test.ts`) still pass.
- `pnpm check:rules` — 55 of 55. `tsc --noEmit` clean.

**Not exercised:** production — this changes future prescriptions for sets with no completion data,
not anything already stored. Nothing device, native, safe-area or offline is touched.
