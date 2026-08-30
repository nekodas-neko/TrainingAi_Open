# 2026-08-30 — `fix/e2e-fixture-not-time-budget` (LB-19) — the flake was the fixture, not the clock

**Lane B · v1.395.1 · test-only.** No product file changes. LB-19's premise is replaced by
measurement; half of it is fixed, half is re-scoped with a mechanism.

LB-19 said two e2e specs fail in-session because they "fit comfortably on CI's runner and do not fit
here", and prescribed `test.setTimeout` on both. **Neither half survived being measured, and the
prescription would have fixed neither.**

## `goal-invalidation.spec.ts` — the row it asserts on cannot render

The failure is `getByText('/ 7,000')` **element(s) not found** after 60 s, inside a test with more
than a minute of its 180 s budget unused. The page snapshot is the tell: the Steps card renders with
**no value line at all**, while Body Weight beside it shows `81.6 kg`.

`seed.sql` writes fourteen days of `body_metrics` ending at `today - 0` — but *its* today is the day
the **seed ran**. Nothing back-fills, and `setup.sh` skips seeding a non-empty `users` table, so an
aged container simply has no row for the current day. `goals-progress-card.tsx` filters `visibleRows`
on `value != null`, so the row the spec is about does not exist to be found.

Measured: `max(date) FROM body_metrics WHERE steps IS NOT NULL` was **2026-08-25** against a
`current_date` of **2026-08-30**.

`ensureStepsToday()` in `e2e/fixtures.ts` now guarantees it. Three things it does deliberately:

- **The date is the USER's, not the runner's** — the same derivation `suppressMorningCheckin`
  already uses. The screens read `todayInTz(session.user.timezone)`, and the container's zone is not
  the seeded user's.
- **8000**, which is exactly what the seed writes for `d = 0`, so the spec reads the same on a fresh
  database and an aged one, and the 7,000/9,000 goals stay distinct from it.
- **Non-destructive**: an existing steps value is left alone, and `restore()` puts back precisely
  what was there — deleting a row it created, nulling a column it filled, or doing nothing.

Verified: passes twice consecutively at **1.4 min**, and `SELECT count(*)` for that day is **0**
afterwards.

## `meal-label.spec.ts:111` — intermittent, and not time either

It failed once in a whole-file run with *"Ingredients · centred's code must decode off the rendered
label"* — a zxing decode returning **null**. It then passed alone (2.8 min) and passed again as a
full file (3.1 min), 5 of 5. So it is a flake, and when it passes the file finishes well inside its
budget; the old "exceeds its own 180 s timeout" reading does not survive a re-run.

**The mechanism came from reading the loop, not from guessing.** Each iteration clicks the style
radio, waits on `expect.poll(inkFraction).toBeGreaterThan(0.01)`, then reads the canvas and decodes.
That poll **cannot distinguish the new style's paint from the previous style's** — the canvas already
carries ink from the last iteration, so the condition is satisfied instantly and the read can land
mid-repaint. Under file-level load the window widens, which is the shape of an intermittent null.

**The obvious fix is wrong and the entry says so.** Polling the decode until it succeeds would pass
on the stale paint: every style encodes the same meal, so the previous canvas decodes to the same
token. What is needed is a signal that *changes* with the style — canvas dimensions, or the sheet's
reported physical size. Establishing which of those differ per style needs the spec's own fixture
meal, so it is left as work rather than guessed at.

## The finding worth more than either spec

A spec that depends on the seed having run **recently** is the hardcoded-timestamp rule in
`CLAUDE.md` wearing a different hat: one side of the comparison is the real clock, the other is
frozen. It fails only on a container old enough to have drifted, and CI provisions a fresh database
every run — so it is invisible exactly where it would otherwise be caught, and it presents as a
locator that never resolves rather than as a wrong value.

**Another session reached the same class from the other side while this was in flight:** #593,
*"Derive the heart-rate collapse fixtures from the clock"*. That is what the local suite was failing
on when this branch was still behind `main` — a reminder that a red local run is worth attributing
before it is believed.

## Not exercised

- No product code changed, so nothing new to verify on device.
- `meal-label` is not fixed, only characterised. It remains in LB-19.
- The restore path was driven for the **insert** case (no row for today). The two other branches —
  an existing row with a null `steps`, and an existing row with a value — are covered by reading,
  not by a run, because the local database only presents one of the three.
