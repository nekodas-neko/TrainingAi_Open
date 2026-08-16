# 2026-08-09 — Adversarial input found a real gap, and one of my own findings was wrong

**Branch:** `claude/token-usage-strategy-7cx7z9` · **Domains:** `activity`, `platform`, `app-shell`

## The retraction first, because it is the more useful half

**Q-151 was a false positive.** I claimed `/sign-in` carried a second live React #418 hydration
mismatch and tied it to production's 153-hit #418 series. **#1184 refuted it and was right:**

- **Zero of 272 production #418s are on `/sign-in`** — all are on authenticated routes.
- The series **stopped nineteen minutes after Q-73's deploy**, against a ~4/day fortnight baseline.
- It **does not reproduce** across eight runs, dev *and* production build, under four localStorage
  theme states.

What I actually saw was the **dev-mode** React warning *"A tree hydrated but some attributes…"*. Two
mistakes stacked:

1. I treated a dev-build diagnostic as evidence of a production error. React's dev build emits
   hydration warnings the production build does not.
2. I attributed a production count to a route **without checking the `url` column — while already
   querying that table.** One `GROUP BY url` would have killed the claim before it was filed.

The second is the one worth carrying: the disproof was one clause away in a query I had already
written. **"I saw an error on page X" and "the production counter for that class is high" are two
separate claims, and joining them requires evidence, not adjacency.**

## The real finding: a 69-day walk

`POST /api/activity-logs` with `durationMin: 100000` → **201 Created**, row persisted. (Deleted
afterwards; local DB verified clean.)

`packages/shared/src/validation/activity-log.ts:37` is `z.number().positive().optional()` — positive,
unbounded — as are `distanceKm`, `caloriesBurned`, `elevationGainM` and the HR fields.

**The codebase already solves this**, which is why it counts: `body-metrics.ts:95` is
`z.number().min(WEIGHT_KG_MIN).max(WEIGHT_KG_MAX)`, bounded with named constants. **32 numeric
validators carry `.max()`; 28 do not.** A good pattern applied to half the surface.

Two consequences beyond the obvious: `deriveEndTime` adds `durationMin` to `startTime`, so an
over-long value produces an end timestamp days later and can push the activity into the wrong day
bucket — and **the plausible typo is more dangerous than the absurd one**, because 1000-for-100
inflates a week while looking entirely normal.

Filed as **Q-164**, flagged as a strong CI-check candidate: a `z.number()` in a validation schema with
no `.max()` is mechanically detectable, and the shrink-only grandfather pattern lets the 28 be burned
down without a big-bang PR.

## What correctly rejected

Worth recording so the finding isn't read as "validation is weak": negative durations (400), a
500-character emoji + RTL title (400), out-of-range body fat, and every bad weight value (0, 999, −50,
`"abc"`) were all properly refused. **The gap is specifically the upper end of otherwise-validated
numerics.**

## Contrast: third attempt, and a stop

Lens 10 left contrast unmeasured after two failed methods. Third attempt started with a **self-test** —
render black on white, expect ~21:1 before trusting anything.

**It returned 1.96:1.** Broken in a case whose answer is known, so nothing measured with it should be
believed — including Lens 10's ten discarded numbers.

Two things came out of it anyway: the self-test instantly caught a `clip` key-name bug (`w`/`h` vs
`width`/`height`) that plausibly caused attempt 2's uniform 1:1 results, and **the next attempt now has
a known-good target to iterate against** instead of guessing at real screens where nobody knows the
right answer. Three attempts is enough for one session; the harness is the deliverable.

## Not covered

Boundary dates, offline write behaviour and rapid double-tap need a driven UI flow rather than a direct
POST, and were not reached. `/api/body-metrics` has no POST handler (404), so the weight-bounds result
above is from reading the schema, not exercising the live path. No device, no APK, no native SQLite.
