# 2026-09-26 — `lane-b/lb162-remaining-bars` (LB-162) — the three bars RV-207 could not convert, and why each resisted

**Lane B · three `width` bars → `ProgressFill`. No version bump: no user-visible behaviour changes,
only how the same pixels are produced.**

RV-207 ⑤ listed six `width`-animating bars as one quick win. Three converted straight; the other
three each needed something the primitive did not have, and this is that.

## `ProgressFill` gained two props

**`origin`, as a PROP rather than a `className` passthrough.** `body-battery-card`'s track is
`flex justify-end` — the tank empties from the **left**, so the fill has to grow from the right.
`ProgressFill` hard-coded `origin-left`, and a caller passing `origin-right` through `className`
would be two `transform-origin` utilities of **equal specificity**: which one wins is decided by
the order Tailwind emits them, not by the call site. That is a coin-flip dressed as an override.

**`boxShadow`, optional.** `warmup-screen`'s bar carries a glow. `transform` scales a box-shadow
with the element, so the glow's horizontal spread now shrinks with the bar — **inherent, not an
oversight**, and at 8 px of blur on a 2 px-high bar it is not a visible difference. Recorded on the
prop so nobody "fixes" it later without knowing it was considered.

## The muscle-sets bar: clip the fill, not the track

`weekly-muscle-sets-card`'s track is `overflow-visible` **on purpose** — two `h-3` target markers
deliberately stand proud of an `h-2` track. But `ProgressFill`'s own docstring warns that an
unclipped `rounded-full` fill goes visibly oval under `scaleX`, so the naive fix (clip the track)
would have eaten the markers.

The clip moves to a wrapper around the fill alone. Both mutations — clipping the track instead, and
dropping the wrapper — fail a different assertion.

## What the warmup bar kept

`width 1s linear` ticking once a second is what made this the highest-value of the three. Both
halves survive: `durationMs={1000}` and `className="ease-linear"`, because `ProgressFill`'s default
easing is not linear and a linear tick reading as eased would be a visible change.

## Two render attempts, and neither produced evidence

The previous entry's lesson was *render it*, so I did — twice, and got nothing usable. Recording
why, because the harness is otherwise the right tool and the next person should not re-spend it:

- **Home came up on the zero-data account.** The greeting read "TrainingAI" with a `?` avatar
  rather than "Good afternoon, Test User" and **TU**, and Body Battery is absent on that account —
  so the one bar I most wanted to compare was not on screen. An earlier run in the same session,
  same config, got the seeded user, so this is non-deterministic rather than a config error.
- **The Health capture stopped above the muscle-sets card**, even at `fullPage: true`, and
  scrolling to it by text **timed out at 180 s** against `next dev`.

So: sound by construction, mutation-tested at source, and **unseen**. The `Keep:` on the entry says
so and carries a pass test rather than an assurance.

## Not done

The three `height: auto` collapses (`meal-card`, `body-battery-card`, `achievements-section`) stay
on LB-162. Each replacement changes how the open reads, which is a look decision per site rather
than a sweep.

## Gate

Full suite **10,121 passed / 87 skipped** · `check:rules` **Ran 80 of 80** · lint **0 errors / 817
warnings, equal to base** · tsc, test-typecheck, build, doc gates clean by exit code.

One thing the gate caught that a green `tsc` did not: the new spec used the regex `/s` flag, which
`tsconfig.tests.json` targets too low to allow. `check-test-typecheck` reads a different config
from the app's, so the app typecheck passing says nothing about a spec.
