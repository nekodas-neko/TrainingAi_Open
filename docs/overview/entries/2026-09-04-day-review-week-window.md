# 2026-09-04 — the day review's 7-day comparison window (Q-112c)

**Branch:** `feat/day-review-week-window` · **Lane:** A · **Domain:** readiness / platform

## What shipped

`GET /api/day-review/week-window?date=YYYY-MM-DD` — the prior-7-day series the day review draws its
trends from. It is the engine half of Q-112, and it comes first because the render has nothing to
draw without it.

One payload serves both readings the next phase needs: **eight ascending points** (`date - 7` …
`date`) for a sparkline, and a **seven-day mean** for a "vs. last week" delta.

**The mean excludes the anchor day.** Comparing a day against a window it sits inside pulls the
baseline toward the value being judged, so the delta reads smaller than it is. A test pins it:
seven days at 60 and today at 100 must average 60, not 65.

**Nulls are not zeros.** A day with nothing recorded returns null for that stat. Zero would render as
*"you walked no steps"* — a claim — where null is the absence of one.

## Deliberately only four stats

The plan's Q-112c text mentions reusing `buildDayAudit` for scores and `body_metrics` for
composition. The next phase then rules both out: composition moves too slowly to read as anything
but noise over seven days, and scores already carry `scoreBand()`'s word, so a delta beside a band is
two answers to one question. Serving series nothing is allowed to draw is speculative surface, so
this returns exactly the four the render uses — resting HR, steps, session volume, weight.

## The timezone case, and why the fixture uses `Etc/GMT-10`

Session volume is bucketed by the **user's** local day, not UTC. The test seeds two sessions at 01:00
local on the anchor day — which in UTC is the *previous* calendar day for a +10 zone — and asserts
both land on the anchor day and are summed.

The fixture zone is a fixed-offset `Etc/GMT-10` rather than `Australia/Brisbane` on purpose: this
class of bug only shows when local midnight is not UTC midnight, and a fixed offset has no DST, so
the case fires on every CI run instead of half the year. **Mutation-verified:** swapping the bucket
to `toISOString().slice(0, 10)` fails that test and no other.

## Fixed on the way

`/api/workout-load-history` opened its 90-day window with `new Date(Date.now() - 90 * 86_400_000)` —
the ms-offset pattern CLAUDE.md bans and that this plan's own Q-112c section warns about by name
("six copies of that banned pattern have shipped in this repo before"). Now anchored at a local
midnight. The effect there was small, since the results are bucketed by `toAestDay` afterwards — one
boundary day in or out — but it is the banned shape in the exact route this work was told to reuse.

## Queue hygiene

Q-112c's entry is removed, as the protocol requires of finished work. LB-24's blocker was prose —
*"do not delete the route yet"*, because Q-112c reuses the route — so it printed as READY with
nothing startable in it. It now carries `Needs: Q-112d`, which the lane runner can read.

## Not exercised

Both routes confirmed loading under the real Next runtime on `pnpm dev` (unauthenticated → 401,
failing closed); the authenticated read paths run in tests against the same local Postgres. No
device surface, no UI — the render is Q-112d's, in Lane B. No production data.

## Gates

lint clean · `tsc --noEmit` clean · `pnpm check:rules` 67 of 67 · full suite 757 passed | 5 skipped
(762 files), 6443 tests passed.
