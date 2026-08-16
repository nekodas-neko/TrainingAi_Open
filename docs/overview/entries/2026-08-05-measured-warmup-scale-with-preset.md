# 2026-08-05 — the measured warmup carve-out now scales with the chosen preset (Q-83, v1.266.0)

**Branch:** `fix/measured-warmup-scale-with-preset` · **Domain:** `workouts` · JS-only, no APK needed.

## What was wrong

`warmupBudgetMin()` has two paths. Below ~8 completed sessions it takes `WARMUP_FRACTION` (15%) of
the chosen budget, which scales correctly across presets. Once a measured warmup median is learned
(`buildMeasuredTimeBudget`, `time-audit.ts:307-332`) it takes that **absolute** number of minutes and
subtracts it from whichever preset budget was chosen — unscaled. So the same learned 9 minutes cost a
Quick (30 min) session 30% of its budget, a Normal (60 min) 15%, and a Long (90 min) 10%. The owner
picked Quick on a Push session and got two exercises.

## The fix

A proportional ceiling on the measured carve-out — but applied **only when today's budget is below
the session's own configured length**. `warmupBudgetMin`/`workingBudgetMin` take a third optional
`standardBudgetMin`; `signals.ts:499-503` passes `programSession.timeBudgetMinutes` alongside the
preset-adjusted budget it already passed.

`WARMUP_CEILING_FRACTION = 0.2`, chosen for two properties rather than by feel:

- It is above `WARMUP_FRACTION` (15%) on purpose. Warmup does not shrink linearly with the working
  portion — walking to the gym, joint prep and ramp sets cost what they cost — so a squeezed session
  is allowed a larger *share*, just not an unbounded one.
- `0.20 × MIN_PRESET_BUDGET_MIN (20) = MIN_WARMUP_MIN (4)` exactly, so the floor and the new ceiling
  meet at the shortest legal budget and can never invert for anything `budgetForPreset` emits.

## Why the ceiling is gated on the standard length, not applied always

The plan proposed a plain fraction-of-budget ceiling. That is wrong for a session **genuinely
configured** at 30 minutes: there a 9-minute measured warmup really is 30% of the session, learned at
that length, and capping it to 6 would under-reserve and make the session overrun. The double-charge
only exists when a median learned at 60 is subtracted from a budget shortened for today. Gating on
`totalBudgetMin < standardBudgetMin` separates those two cases; a plain fraction cannot.

The gate also makes the change provably inert on the standard path — no existing plan at any
configured length changes — which is why all pre-existing `duration-model` tests passed untouched.

## Verified

Measured through the real `POST /api/ai-periodization/session/[id]/prescribe` route in `pnpm dev`,
authenticated as the seeded user, with a 9-minute warmup seeded onto its 9 completed sessions (the
seed has `warmup_ended_at` null everywhere, so the measured path never triggers without it). Same
data both sides, code stashed and restored:

| preset | before | after |
|---|---|---|
| short (30) | 2 dropped, est **11 min** | 1 dropped, est **22 min** |
| standard (60) | 0 dropped, est 47 min | unchanged |
| long (90) | 0 dropped, est 64 min | unchanged |

Stable 4/4 runs on each side, so this is not LLM sampling variance. A single `long` run once read 62
rather than 64 — that is the model picking different sets/reps, not the budget path, which the
deterministic `aggregateSignals` probe confirms is byte-identical at standard and long (warmup 9,
working 51 and 81 before and after; short moves 9→6 and 21→24).

Full suite 400 files / 3,165 tests green (+2 new). Typecheck clean, lint clean, `check-push-mutations` OK.

## The finding this did NOT fix — worth knowing before anyone re-opens it

The fix recovers 3 working minutes at Quick. On a synthetic five-exercise Push, the trimmer's
exercise-count thresholds sit **~6–7 minutes apart** (1 exercise below 29 min, 2 at 29, 3 at 35, 4 at
41, 5 at 48). So +3 minutes only crosses a threshold when a session happens to sit within 3 minutes
of one — it did on the owner's real session, and would not on many others.

The dominant cost at Quick is not warmup at all: a single main compound at 4×5 with 180 s rests is
~19 minutes, most of a 21–24 minute working budget, and ~12 of those are rest. Compressing rest on a
shortened session is the lever that would actually change exercise counts, and it is a
prescription-quality decision for the owner rather than something to slip into this fix. Filed as a
new backlog entry.

## Files

- `packages/shared/src/workout/duration-model.ts` — `WARMUP_CEILING_FRACTION`, the gated ceiling in
  `warmupBudgetMin`, `standardBudgetMin` threaded through `workingBudgetMin`.
- `packages/shared/src/ai-periodization/signals.ts:499-503` — passes the session's own budget.
- `lib/__tests__/duration-model.test.ts` — two new blocks: the cap binding at a shortened budget
  (including the floor/ceiling meeting point), and its inertness at/above the standard length, with
  no reference passed, and for a 15-min measured warmup at 60.
