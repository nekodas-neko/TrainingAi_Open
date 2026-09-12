# 2026-09-12 — The weight dial swaps to pounds by tapping its own unit (BF-141)

**PR:** `fix/bf141-weight-dial-unit-toggle` · **Lane B** · `components/workout/weight-unit.ts` (new),
`components/ui/weight-dial.tsx`, `components/workout/set-card.tsx`,
`components/workout/active-set-card.tsx`, `components/workout/active-workout-screen.tsx`,
`e2e/weight-dial-unit-toggle.spec.ts` (new).

Owner, from the logging screen for Dumbbell Lateral Raise: *"my Dumbells are pounds and I need to
convert it. im 90% in kg but some are lb ... then just have it convert to the kg equivalent"*.

This is prevention for a failure that already happened, on that exercise. Session 119 (2026-06-15)
records three dumbbell exercises logged in pounds into the kg field; the repair needed an admin
preview/apply tool that still ships, which rescaled every set and **backdated the all-time PR**.

## The entry was wrong about its own test gate

BF-141 said *"`e2e/touch-target-size.spec.ts` will fail this if it is done any other way"*. It
cannot. That spec scans `SCREENS = ['/', '/health', '/workout', '/nutrition', '/more']` — the five
tab roots. This dial lives inside an **active** workout at `/workout?session=…`, which is none of
them, so its deliberately-empty allowlist would have stayed green over a 20 px suffix.

`e2e/weight-dial-unit-toggle.spec.ts` drives into the first set and measures the control there.
Removing `.tap-target-44` turns its reachable box from `44px` to `auto` and fails it — checked.

## What the mutations caught, and the one they did not

Five mutations were run. Four failed as intended: routing the conversion through `mround125`
(three cases), reusing the kg step for lb detents, making the memory global rather than per-exercise,
and dropping `.tap-target-44`.

**The fifth passed, and saying otherwise would have been a false claim in a test name.** Removing
`stopPropagation` from the suffix left the spec green. The reason is arithmetic: the dial row is
itself a click target calling `onChange` with the row's own value, which in lb mode round-trips
kg → lb (2.5 lb detent) → kg and *is* lossy — 61.0 kg comes back 61.25. But the seeded workout starts
at **60 kg**, which round-trips exactly (132.5 lb → 60.0), so the propagation has nothing to change
in the fixture. The guard is real and seed-dependent; both the spec and the component now say so, so
the next reader does not delete it as dead weight. The test was renamed to what it proves.

## The rounding hazard, which is the thing that would have ruined this quietly

`mround125` and `mroundStep` are `Math.max(5, …)`. A 5 lb dumbbell is 2.27 kg and comes out of
either as **5 kg** — silently more than double. `fromDisplay` rounds to 0.25 kg, the precision the
2026-06-15 repair tool used for derived figures, and routes through neither. The test asserts the
clamp explicitly rather than just asserting the right answer, so the mutation that reintroduces it
fails loudly.

In lb mode the dial steps **2.5 lb**, because 1.25 kg is 2.76 lb — a grid with no dumbbell on it.

## Two things that did not go the way the entry expected

**`workout-screen.tsx` was never touched.** It is shrink-only at 1833 lines and the entry's "one
prop threaded" would have broken that. But `active-workout-screen.tsx` already holds `exercise` in
scope and is not pinned, so the thread is three unpinned files. The entry's "if the per-exercise
memory pulls in more than expected, a plan is the right call" fork did not trigger.

**The hooks had to go above the early returns.** `SetCard` has three, and `useState` inside the
`isActive` branch is `react-hooks/rules-of-hooks` — which `tsc --noEmit` does not see and CI's Build
job does. Caught locally by reading the build output properly rather than by CI, but only after
first mis-reading a `grep` for the filename as "clean" when it had printed the filename *because*
there were findings under it.

## Verification

Full unit suite **7,185 passed / 8,454 total**; `pnpm check:rules` **Ran 73 of 73**; production build
clean; lint clean in every touched file. `e2e/weight-dial-unit-toggle.spec.ts` 2/2 and
`e2e/workout-set-loop.spec.ts` still green beside it.

**Not exercised:** the S25. A scroll-snap dial with haptics beside a new inline control is a
touch-target and gesture question, and the harness drives a mouse — it can prove the box is 44 px and
cannot prove a thumb reaches it without also moving the dial.
