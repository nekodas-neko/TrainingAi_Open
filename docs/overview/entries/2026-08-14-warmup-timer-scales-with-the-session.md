# 2026-08-14 — the Warm Up countdown finally reads the same budget the plan was built from (Q-212)

**Branch:** `claude/trainingai-backlog-v0abea`

Owner, on a 30-minute Quick session: *"its still giving 10minutes warmup for the 30min session. it
should of been a % pf time. so should of been only 5minutes for the quick session?"*

They were right, and the number they expected was already being computed — just not by the screen
they were looking at. `warmup-screen.tsx` counted down from `WARMUP_GOAL_SEC = 600`, a flat
constant with no session-length input anywhere in the component's interface. Meanwhile
`warmupBudgetMin()` in `packages/shared/src/workout/duration-model.ts` has been live and correct for
months, shaping the `effectiveTimeBudgetMin` the AI prescription is trimmed against — so the app was
already building a *shorter exercise list* for a Quick session while telling the lifter to warm up
for the full ten minutes.

Two concepts, one of which scaled. Now one:

```ts
export function warmupGoalSecFor(
  sessionBudgetMin: number | undefined,
  preset: DurationPreset | undefined,
  measuredWarmupMin?: number | null,
): number | null
```

It is a thin composition of the two functions that already existed — `budgetForPreset()` then
`warmupBudgetMin()` — deliberately so. No new formula was written; the point of the fix is that
there is exactly one, and the countdown now calls it. `WarmupScreen` takes `warmupGoalSec` as a
required prop, and `WARMUP_GOAL_SEC_FALLBACK` (still 600) is used only while `sessionBudgetMin` is
unknown — i.e. before `workout-data` has landed.

**Two call sites, not one.** The countdown is the visible half, but `startRestChip()` in
`workout-screen.tsx` anchors the Android rest-timer chip to the same number. A fix to only the
screen would have left the notification shade still saying ten minutes.

## What the tests pinned, and the thing they refused to change

Six cases in `duration-presets.test.ts`. The load-bearing one is that a 30-min budget on the Quick
preset produces **less** than the flat 600 s, and that Standard/Long/Quick at the same budget produce
three different numbers.

One test asserts something that looks wrong and is not. `MIN_WARMUP_MIN` / `MAX_WARMUP_MIN` bound the
**measured** branch only; the 15%-fraction fallback is deliberately unclamped, so a 20-minute budget
yields 3 minutes, under the 4-minute floor that applies to a measured warm-up. My first assertion
said `>= MIN_WARMUP_MIN` and failed — the model was right and the assumption was mine. The test now
pins actual behaviour rather than quietly widening a floor into live planning math. Whether that
asymmetry is intended is a real question, but it is a *planning* question and not this fix's to
answer.

**Mutation-verified twice:** reverting `warmupGoalSecFor` to a flat 600 fails 5 of the 6; making it
ignore the preset fails 4.

## An extraction the size gate forced, and was right to

The `useMemo` pushed `components/workout-screen.tsx` from 1,849 to 1,862 lines, past its shrink-only
1,850 baseline. Rather than raise the baseline, the duration-preset concern moved out whole —
`warmupGoalSec`, `durationSwitching` and `handleDurationPresetChange` now live in
`components/workout/use-duration-preset.ts`, which is where they belonged anyway: they are one
feature that had been three unrelated-looking members of a 1,800-line orchestrator. The file is 1,829
lines now, so the gate ends this change smaller than it found it.

## Verified

`tsc --noEmit` clean, lint 0 errors, `pnpm check:rules` 33 of 33, full suite green.

**Not exercised:** the S25. The arithmetic is pure and covered, but *seeing* a 5-minute countdown on
a Quick session — and the rest-timer chip in the notification shade agreeing with it — is a device
observation this sandbox does not make. The chip in particular is a native surface with no web
analogue.
