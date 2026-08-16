# 2026-08-05 — Two owner-reported gaps triaged and queued (Q-83, Q-84)

**Branch:** `claude/workout-time-ai-prescription-lmbmuh` · **Domain:** workouts (also cardio) · **Version:** unchanged (docs-only)

## What changed

Docs-only planning session — no code touched, no version bump. Two owner-reported observations
were investigated to root cause and queued as backlog items, per the standing backlog-driven
protocol (plan doc + queue entry, no implementation).

**Q-83 — measured warmup carve-out doesn't scale with the Quick/Normal/Long session preset.**
The owner asked why a 30-min "Quick" Push session prescribed only 2 exercises. Traced to
`workingBudgetMin()`/`warmupBudgetMin()` (`packages/shared/src/workout/duration-model.ts:36-53`):
before ~8 sessions of history, warmup is 15% of whatever budget the preset produces (scales
correctly); once a per-lifter warmup median is learned (`time-audit.ts:307-332`), that becomes a
**fixed absolute minute count** subtracted from the preset budget with no scaling — so Quick loses
30% of its budget to warmup, Normal 15%, Long 10%, for the same learned warmup value. That's the
real reason `dropToBudget()` has to cut so hard on Quick sessions. Plan:
[`docs/superpowers/plans/2026-08-05-measured-warmup-scale-with-preset.md`](../../superpowers/plans/2026-08-05-measured-warmup-scale-with-preset.md).

**Q-84 — guided-walk summary shows pace, not cadence, for fast/slow intervals.** The owner's read:
for interval walking, cadence (spm) is a more useful effort signal than a noisy short-block GPS
pace. Investigation found this is a smaller gap than it looked — cadence is already tracked live
on the walk screen, computed per interval (`avgCadenceSpm`, `lib/walk/segment-stats.ts:79`), and
persisted, but dropped exactly once, at the fast/slow rollup (`aggregateSegmentsByKind`), so it
never reaches the summary cards or per-interval table. Plan:
[`docs/superpowers/plans/2026-08-05-guided-walk-cadence-in-summary.md`](../../superpowers/plans/2026-08-05-guided-walk-cadence-in-summary.md).

## Deliberately NOT done

Neither item is implemented. Per the backlog protocol, this planning session writes the plan +
queue entry only; an implementer session picks up the top of the queue later.

## Verification

Docs-only — no `pnpm dev`, tests, or device path exercised. Both plan docs were checked against
the actual current-`main` source (file:line references verified by reading the live code, not
written from memory).

## Not verified

N/A — no code shipped this session.
