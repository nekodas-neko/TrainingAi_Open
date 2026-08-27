# 2026-08-27 — `feat/day-review-read-through` (Q-112b) — the wrap-up shows the day it is wrapping up

**Lane B · v1.394.0 · one entry shipped (Q-112b), one filed (LB-25).** Every file is `app/**`,
`components/**` or `e2e/**` — no engine half.

The evening wrap-up asked how the day felt without ever showing the day. Q-112b puts the
read-through — training, activity, energy, sleep, heart rate, body — inside it as step 1, drawn by
**the same component `/health/day` draws**, off the same `day-log:<date>` cache key.

## One implementation, two hosts

`components/health/day-detail/day-read-through.tsx` is the section stack lifted out of
`day-detail-content.tsx` verbatim: same order, same charts, same empty case. `/health/day` renders
it now too, which is what makes "one implementation" a fact rather than an intention — a second copy
would look identical the day it was written and drift from the next section change onward.

**The extraction was cheap for a reason worth recording.** `DayEntryControls` was already
all-optional and already documented *"absent → the section renders read-only"* (LB-1). So the
wrap-up hosts the same markup without growing a second set of write paths, and without a prop
becoming optional for its benefit.

The fetch is deliberately **not** shared. `/health/day` guards each response against a swipe that has
already moved on; the wrap-up is one day and has no way to exercise that guard. Folding them into one
hook would have put a date-race in a component that cannot race.

## The three fetches are gated by the sheet being open, and that took a second component

`EndOfDayReview` is rendered unconditionally by `nutrition-content.tsx` — `open` only drives Radix —
so a `useCachedValue` in its body would have fired **on every Nutrition visit**, three requests, for
a sheet nobody opened. `SheetContent` does not `forceMount`, so a child of it mounts only while open:
`day-read-through-section.tsx` exists to sit on that side of the boundary. The first draft did not,
and that is the kind of regression that never shows up as a failing test.

`useCachedValue` rather than a hand-rolled seed-then-fetch, because this sheet lives in the
persistent tab shell and an empty-dep effect would hold its first payload until the app was killed
(Q-402).

## HR min/max is labelled as what it is, which is not min/max

The entry asked for "HR min/max — derived from the `data.hr` points `DayHrTrace` already receives".
Those points are **15-minute means**: `/api/day-log:271` buckets the per-minute series by average,
deliberately, so one spike cannot become a whole bucket. Averaging is exactly what removes extremes —
a three-minute resting dip to 48 surfaces as about 55, a workout peak of 175 as about 150.

So the pair reads **Low / High** with *"15-min averages"* beside it, rather than a number the payload
cannot support on a screen whose whole job is telling the user what their day was. The true extremes
exist as `oura_bucket.hr_min` / `hr_max` and are recorded in **LB-25** as nearly free if that route
change is ever taken.

## Three steps, and the skip rule lives in a tested function

`review-steps.ts` decides which steps exist. Only the meals step is conditional today, which makes
the module small; it exists anyway because the predicate is *"no meal type is empty"* — a negated
quantifier, the kind of expression that gets inverted in a refactor and reads plausibly either way.
Six tests pin it, including the two shapes a count-based check would get wrong: three logs all
against breakfast (two meals still empty), and a log against a meal type that has since been deleted.

`stepIndex` is **clamped, not trusted**: backfilling the last empty meal removes the step the user is
standing on. And it resets when the sheet closes — reopening on "How it felt" would skip the
read-through the flow exists to show, which is the persisted-transient-state class one level down
from the Zustand rule.

## Two naming collisions, both found by looking rather than by reading

**"Previous", not "Back".** The step-back control cannot say *Back*: the wrap-up step's sore-muscle
chips include one labelled **Back**, so two buttons on one screen would share an accessible name.
Playwright found it as a strict-mode violation; it is an accessibility defect first. Same class as
**LB-23**, from the other direction — there a control collides with itself, here with user-facing
content.

**"The day", not "Your day".** Screenshotting all three steps at 412 dp is what surfaced the second:
the step-1 title read *Your day* and the digest card **on that step** carries a *Your day* eyebrow.
Renaming it then failed the spec for a *third* reason worth writing down — `getByText` matches
substrings, and "The day" is inside the summary card's *"Totals are the day's figures…"* one line
below. The assertion is exact and includes the separator the header renders. A short English phrase
as a step title is ambiguous by default; only an exact match makes it a locator.

## What did not ship, and why it is a Lane A entry

**Body temperature.** The plan wanted it via Q-105's derived-first precedence. Checking that against
`main`:

- `oura_daily.temperature_deviation` is the frozen Cloud column the plan forbids.
- The live values, `oura_daily_summary.temp_mean_c` / `temp_dev_c`, are returned by **no route**.
  `app/api/ai/health-insight` reads `tempDevC` and puts it in a prompt — that is not a payload.
- They *are* in the local store, so a device-only local-first read would work and would be
  unverifiable in `pnpm dev` or Playwright, where `getLocalStore` returns null.

A field on `/api/day-log` is the honest fix and `app/api/**` is Lane A, so it is **LB-25** rather
than a local-first read taken quietly. The AI digest, the entry's third stat, shipped with Q-112a.

## Driven, not inspected

- Removing `<DayReadThroughSection>` fails `the wrap-up shows the day it is wrapping up` and leaves
  the other three green.
- `e2e/day-detail-sheets.spec.ts` + `e2e/day-entry-edit-delete.spec.ts` — **8 passed**, which is the
  plan's own gate on `/health/day` surviving the extraction unchanged.
- The stepping test presses Next until Save appears rather than a fixed number of times, because the
  meals step is data-dependent; encoding the seed's meal coverage into the test would make it lie on
  any other day.

`pnpm check:rules` **Ran 61 of 61**, all passed. `npx vitest run` **5,272 passed, 57 skipped**.

## Not exercised

- **Not device-verified.** The sheet's footer gained a second button and the content is much taller;
  neither is provable in the web harness, and `SheetContent side="bottom"` owning the bottom inset is
  exactly the thing that only fails on the phone. No `pb-safe*` was added inside it.
- The **empty** read-through was not driven: the seeded day always has something. `emptyLabel` is
  passed but unproven.
- The meals step is skipped on the seeded data whenever every meal has a log, so the *three*-step
  path is exercised only when the fixture leaves one empty — the test tolerates both, which is the
  point, but it means one of the two shapes is untested on any given run.
