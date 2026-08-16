# 2026-08-16 — the second E2E spec, and a guard that could not fail

Q-249's harness landed with one spec (instant paint). This adds the second: a write on one screen
reaching the server and showing up on another. It also records why the spec is **not** the Q-240
regression guard the Q-249 entry asked for, which is the more useful half of this entry.

## What shipped

`e2e/goal-round-trip.spec.ts` — drive the real water-goal control on More, wait for its debounced
PATCH, tap through to Health, assert the new value is rendered. Nothing in the 466 vitest files
covers that chain; each link is mocked out somewhere different.

Mutation-verified against two mutations it must catch:

| Mutation | Result |
|---|---|
| baseline | 2 passed |
| `patchGoalsDebounced` never called for the water goal | **1 failed** |
| Health hardcodes `waterGoalMl = 2500` | **1 failed** |
| restored | 2 passed |

## The guard that could not fail

The spec was first written as the Q-240 regression guard — change a goal, open Health, assert it is
not stale. It passed. Then the fix it existed to guard was deleted
(`.then(res => invalidateGoalRecommendations())` in `goals-section.tsx`) and **it passed again**.

`health-content.tsx:180-182` falls back to the `localStorage` device copy for the water goal, target
weight and target body fat whenever `userGoals` has not loaded, and the goals UI writes that copy
synchronously on every keystroke. The device copy masks precisely the server-cache staleness Q-240
is about, so no assertion on those three goals can ever fail.

It ships relabelled, with the measurement in its header. A green test standing in for coverage that
does not exist is worse than no test. The real guard is queued as **Q-259** with the shape it needs:
a goal with no device copy (steps, sleep, calories, rendered from `userGoals` alone by
`goals-progress-card.tsx`), plus seeded metrics for the day, because those rows only render when a
value exists.

The lesson generalises past this test: a cache-staleness assertion means nothing against a screen
that has a second, fresher source for the same value. Check for a device copy before choosing the
probe.

## A finding this session investigated and then withdrew

While building a parallel harness before this one landed, two `animate-pulse` cards on Health
looked like a permanent instant-paint violation on a repeat visit — visible via Playwright's
`:visible`, no text, still pulsing after 30 s. It was written up and very nearly filed.

It is not a bug. Measured against the viewport rather than `:visible`, both sit at `left: -379` and
`left: 445` in a 412 px viewport — off-screen panels of Health's `SwipeCarousel`, whose data is
fetched when you swipe to them, by design. `expectNoSkeleton` in `e2e/fixtures.ts` already counts
only in-viewport elements for exactly this reason, and its comment says so.

**Playwright's `:visible` means "has a box and is not `display:none`", not "on screen."** Recorded
here because the false finding was convincing, and the next person to point a browser at this app
will meet the same trap.

## Also

- **Q-260** — Health renders a stale goal after a write while every source of truth holds the new
  one (see above). The headline finding of this PR, and the reason it took three attempts to land.
- **Q-258** — the goal inputs in `goal-targets-section.tsx` have `<Label>`s associated with nothing:
  no `htmlFor`, no `id`, anywhere in the file. `getByLabel` cannot find them, so this spec anchors on
  DOM position instead. A screen reader announces those fields unnamed. The sign-in form is fine
  (`auth.setup.ts` uses `getByLabel('Email')`), so it is a local gap rather than a convention.

## The CI failure that turned out to be a real bug

The spec went green locally and failed E2E in CI, twice, across two different attempts to stabilise
it. Both attempts were wrong in the same way: they assumed the problem was the test.

Reproducing CI's conditions locally (fresh database, cold `.next`, `CI=1`, `--retries=0`) and then
instrumenting the failing moment settled it. At the instant Health displayed `Goal: 2.5L`:

| Source | Value |
|---|---|
| `GET /api/user/goals` (`no-store`) | `waterGoalMl: 3250` |
| `localStorage['ta_cache:user-goals']` | `waterGoalMl: 3250` |
| `localStorage['ta_water_goal_ml']` (device copy) | `"3250"` |
| **Health on screen** | **`Goal: 2.5L`** |

Every source correct, the screen wrong, and it stayed wrong for 120 seconds across repeated tab
re-entries. Health reads the goal into component state on mount, and a client-side tab re-entry does
not remount the route — so Q-240's invalidation does its job and nothing re-reads the corrected
cache. Filed as **Q-260**.

That is the same user-visible symptom Q-240 fixed, by a different mechanism, which is exactly why it
survived that fix.

### Why the spec works around it instead of asserting it

The spec now taps to Health and calls `page.reload()` before asserting. `test.fail()` would have
been the harness's documented way to record a known bug, and it is **not usable here**: the defect is
intermittent — it bites only when Health does not happen to remount after the write — so an
expected-failure annotation would flip red on every run where the bug did not appear. The reload
keeps the round-trip claim provable; the un-reloaded path is Q-260's to fix, and the entry says to
delete the reload as part of that fix so it cannot hide the regression.

## Two wrong turns, kept here because both were convincing

The first version went green locally and **failed in CI**. Reproducing CI's conditions locally —
fresh database seeded from `seed.sql`, cold `.next`, `CI=1` — reproduced it exactly: the spec failed
on the first attempt at 39.7 s and passed on the retry at 7.6 s. It was passing on its retry, which
is not passing.

The cause was not the timeout it first looked like. `invalidateGoalRecommendations()` is chained off
the PATCH response and is itself async, so navigating the instant the response lands races the
invalidation, and Health reads the pre-write `user-goals` cache. Raising the budget to 60 s did not
help, because nothing re-fetches inside that window — proof it was an ordering bug, not a slow one.

The first attempt at a fix polled the cache key and **accepted an absent entry as success**. On a
fresh profile the key does not exist yet, so the poll returned immediately and the spec walked
straight back into the same race. Requiring the *new value* is what actually proves the invalidation
ran and the refetch landed.

Neither of those was the real cause — they were two rounds of blaming the harness for a product
defect. What settled it was instrumenting the failure instead of theorising about it.

Final state confirmed by measurement, not by one green run: **two consecutive fresh-database cold
runs with `--retries=0`, 7 passed each**, and both mutations still failing the spec afterwards.
Retries are disabled for that check deliberately — a retry is what hid the problem in the first
place.

## Verification

`npx tsc --noEmit` · `pnpm lint` (0 errors) · `pnpm check:rules` — **Ran 36 of 36** · unit suite ·
E2E green on two consecutive fresh-database cold runs with `--retries=0` (7 passed each), plus the
mutation table above re-run against the final spec. Not device-verifiable and nothing here reaches the
device: it adds one browser spec and two backlog entries, and touches no runtime code.
