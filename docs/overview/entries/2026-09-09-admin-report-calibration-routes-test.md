# 2026-09-09 — three admin reports, and a `.strict()` that cannot fire (PS-39, 19 → 16)

**Branch:** `test/admin-report-calibration-routes` · **No product change.**

33 cases over `admin/app-load-report`, `admin/timing-baseline` and `admin/sleep-feel-calibration`.
They share the admin gate and parse their window three different ways, which is most of what a
route-level test can hold a read-only report to.

## The lead-in is the assertion

`sleep-feel-calibration` fetches **28 days more sleep than it reports on**, and only sleep — the
check-ins are fetched for the requested window exactly. The earliest night has to be scored against
real baselines: the HRV/HR/schedule contributors need seven prior nights and the baselines are built
from a 28-day trailing window, so scoring the window in isolation strips those contributors off its
first nights and the model's spread reads narrower than it is.

That means the two repository calls take **different ranges**, and a test asserting only "sleep was
fetched for the window" would pass with the lead-in deleted. Both ranges are now asserted, and a
mutant that applies the lead-in to the check-ins instead is caught too — it is the same edit made in
the wrong place, and it would quietly widen the join rather than narrow it.

## What the other two decide

- **`app-load-report` splits cold from warm and reports both totals.** Every merge is a deploy, the
  service worker's cache name is stamped from the deploy SHA, so a pooled percentile measures
  release cadence rather than the app. The fixture carries two cold rows of 3 and 4 samples — one
  row each, or two rows with matching counts, could not tell "sum the samples" from "count the
  rows". A side with no rows reports **0** rather than being omitted, because "no cold samples
  recorded" and "the app is never cold" are different findings and an absent key reads as the second.
- **It refuses a window wider than retention rather than clamping it.** `.max(14)` rejects. That is
  the better half of the choice: a clamp answers 200 with `days: 14` to someone who asked for 30 and
  believes they are reading a month.
- **`timing-baseline` accepts an explicit `null`**, because clearing the baseline is the operation
  you reach for when the stored one is wrong. Both date separators are accepted (Q-130), and the
  two 400s — a body that cannot be read versus one that reads and is rejected — carry different
  messages, which a status-only assertion could not tell apart.

## A `.strict()` that guards nothing — LA-88

`app-load-report`'s query schema is `.strict()`, and `?unknown=1&dayz=30` still answers 200. The
route hands the schema an object it built itself, holding only `days`, so every unknown key is gone
before validation runs.

Measured across `app/api` rather than left at the one case: **five routes are in that state** —
`admin/app-load-report`, `admin/ai-usage` (confirmed by test in an earlier batch), `coach/options`,
`exercise-gif`, `nutrition/barcode`. `running-plan/runs/[id]` spreads the real body before adding
`id`, so its `.strict()` **does** fire, which is what makes the difference structural rather than
stylistic.

This is not five bugs — for a GET whose only input is one named param, dropping the rest is arguably
right, and 400-ing on a cache-buster would be worse. The cost is the report. Q-464's checker says
these routes are protected and the next person to add a second param will believe the typo guard is
already there. That is the shape #1019 fixed for `check-admin-guard-catch.js`, whose one-line regex
matched 0 of 2 real defects while 12 live sites carried them. Filed as **LA-88** against the
checker, not the routes.

Second checker in a month found blind to its own class, so it is worth stating plainly: **when a
check is cheap to satisfy structurally, verify it fires on a real instance of the thing it names.**

## Two assumptions the tests corrected

Both were mine, and both were rebuilt against the route rather than adjusted to pass: `.max(14)`
**rejects** rather than clamps, and `.strict()` cannot fire on a hand-built object. The second is
now LA-88.

## Mutation pass

**21 of 21 caught**; the twenty-second is an equivalent mutant planted as a control and survived as
designed. One mutant needed re-planting after an anchor miss — an anchor that does not apply is not
a caught mutant, and counting it as one would inflate the score by exactly the case that was never
run.

## Gate

`pnpm lint` 0 errors (608 warnings) · `npx tsc --noEmit` clean · `check-test-typecheck` none above
baseline · **Custom Rules 70 of 70** · `pnpm build` clean · full suite green · route ratchet
**19 → 16**.

**Not exercised:** the scorer, the night assembly and the calibration builder are all mocked, so
this says nothing about whether a score is right — only which window each is asked for. No SQL runs.
Web/Node only: no device, no native surface.
