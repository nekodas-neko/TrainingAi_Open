# 2026-09-17 — the streak went down on a day he trained, and the reason is a sliding window

**BugFix intake.** Docs-only. Owner: *"My streak went from 90 -> 89? Can we check to see what it
should be and why it went down"*. Filed as **BF-176**.

## What it should be

**102 days**, starting 2026-06-08, unbroken under the app's own rule (two rest days allowed, the
third breaks). The card said 89.

## Why it went down

Two halves disagree about how far back to look:

- `app/api/streak-data/route.ts:5` — `const WINDOW_DAYS = 90`
- `session-select-content.tsx:1019` — `for (let ago = 1; ago < 365; ago++)`

The client walks back a year; the route sends 90 days. Past day 90 every lookup returns `undefined`,
which the loop reads as a rest day, so three of them break the count. Once the real streak exceeds
the window the number stops describing his training and starts describing **where the window edge
lands** — and that edge moves forward every day.

Replicating the loop against production rows:

| Brisbane day | shown | trained |
|---|---|---|
| 2026-09-16 | 90 | yes |
| **2026-09-17** | **89** | **yes** |
| 2026-09-18 | 89 | not yet |

He trained on the day it dropped. The edge slid from 2026-06-20 (a rest day) onto 2026-06-21, and
the day that fell out of the payload was a trained one. It will keep oscillating between ~88 and 90.

## Recommended fix

Return the streak computed server-side, with no horizon, beside `trainedDays`. The window then
bounds only the dots, which is what it was for. Raising `WINDOW_DAYS` to 365 also works today and is
one constant, but it leaves the mismatch implicit and re-appears at a year.

## Two things written into the entry so they are not tripped over

- **`allTimeStreak` on the friends leaderboard is the same defect wearing a louder name** —
  `leaderboard/route.ts:136` computes it over its own `STREAK_WINDOW_DAYS = 90`.
- **There are two streak implementations and they are NOT interchangeable.** `computeStreak`
  (`achievements.ts:32`) counts training days with a `maxRestGap`; the home loop counts calendar
  days spanned, rest days included. Reaching for the shared helper while moving this server-side
  would silently change what 102 means.

## What was not exercised

Nothing on the S25. The streak was recomputed from production rows in a harness that replicates the
client loop line for line — it proves the arithmetic and the transition date, not the rendering. The
payload is also cached (`streak-data`, `TTL_LONG`) and stamped optimistically on workout completion,
so a device check needs the cache cleared or a stale seed will mask it.
