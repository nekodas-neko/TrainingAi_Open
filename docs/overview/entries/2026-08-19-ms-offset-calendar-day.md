# 2026-08-19 — Q-489: a calendar day comes from the date string, never from an ms offset

**PR #189** · branch `fix/ms-offset-calendar-day` · Implementation Lane A · JS/server only.

## The defect, reproduced before anything was changed

Five sites built a calendar day by subtracting milliseconds from `Date.now()`. On a DST fall-back day
— which runs 25 hours — subtracting 24 hours from its **last hour** lands back inside the same local
day, so "yesterday" resolves to today. Measured in `America/New_York` across the 2026 transitions:

```
ok         local 2026-03-08 00:30   now-24h=2026-03-07   true-yesterday=2026-03-07
ok         local 2026-11-01 00:30   now-24h=2026-10-31   true-yesterday=2026-10-31
ok         local 2026-11-01 22:30   now-24h=2026-10-31   true-yesterday=2026-10-31
**MISMATCH local 2026-11-01 23:30   now-24h=2026-11-01   true-yesterday=2026-10-31
```

The 22:30 row is the one worth keeping: the offset is still correct an hour earlier, which is what
makes this **one hour per year per DST-zone user**, not one day.

## The five sites

| site | was | now |
|---|---|---|
| `adapter.ts` (AI-dynamic, 14-day range) | `toAestDay(new Date(Date.now() - 14 * 86_400_000), tz)` | `shiftDateStr(todayIso, -14)` |
| `adapter.ts` (AI-dynamic, `getOuraDailyDerived`) | `toAestDay(new Date(Date.now() - 86_400_000), tz)` | `shiftDateStr(todayIso, -1)` |
| `lib/achievements.ts` (streak continuity) | `formatInTimeZone(new Date(Date.now() - 86_400_000), tz, …)` | `shiftDateStr(todayStr, -1)` |
| `ai-periodization/signals.ts` | `toAestDay(new Date(Date.now() - 24 * 3_600_000), tz)` | `shiftDateStr(toAestDay(todayMid, tz), -1)` |
| `app/api/progress-summary/route.ts` | `formatInTimeZone(new Date(Date.now() - 7 * …), tz, …)` | `shiftDateStr(today, -7)` |

Nothing new was written — `shiftDateStr` already existed and
`lib/data/postgres/slices/oura.ts` already used exactly this shape. In `progress-summary` the correct
form was already on the **next line** (`shiftDateStr(today, -13)`), and `signals.ts`'s neighbouring
`from7d` was already anchored on `todayMid`; in both files the fixed site was the outlier. Removing
the last `formatInTimeZone` use from `progress-summary` made its import unused, so that went too.

**The other seven instances of the banned pattern were deliberately left alone**, as the entry
required. `muscle-recovery`, `workout-load-history` and `friends/feed` use a **rolling instant**
filter feeding consumers that work in hours — for a physiological window that is *more* correct than
a calendar day. Grepping the pattern and fixing all twelve would have been mostly wrong.

## The regression test needed no clock, on purpose

It pins the **divergence** rather than the call sites, so it cannot go stale when a site moves, and
both instants are passed in explicitly — so it fires on **every CI run** rather than for one hour,
once a year, in one timezone. This repo has been bitten twice by tests that only fire inside a window
(Q-356's `periodization-soft-delete`, and the `scale-ble-day-keying` fixture that crossed a rolling
tolerance and went red on every branch), which is the reason for building it this way.

**The test caught my own error immediately**, which is the best evidence it works: the first version
used `2026-11-02T03:30:00Z`, which is 22:30 local — an hour before the divergence — and it failed
rather than passing vacuously.

## Verified

Full suite against the local DB: **488 files / 4,134 tests green**.

Live against `pnpm dev` with the seeded user — `/api/progress-summary` (7-day sleep window),
`/api/achievements` (streak) and `/api/next-session` all returned real data. **The AI-dynamic branch
needed forcing**: the seeded program is `phase_mode='manual'`, so the two `adapter.ts` sites were not
reached by a default request. Flipped the program to `ai_dynamic` in the local DB, re-ran
`/api/next-session` — clean 200, no errors in the server log — and reverted it. Without that step the
two highest-value sites would have been "tested" by a code path that never ran.

## Priced honestly, unchanged

**Unreachable today.** Every user is `Australia/Brisbane`, which has no DST. When it does become
reachable — Q-477's Profile timezone setting and auto-detect button are how a user ends up in a DST
zone — it is one hour per year per affected user. It was worth doing because it is measured, because
it is the exact hand-rolled date arithmetic `CLAUDE.md` bans, and because the fix was a one-line swap
to a helper already in use elsewhere.

## Not exercised

Production, and the APK. The consequence at each call site is read from source rather than observed:
the app cannot be time-travelled here — `faketime` shifts node's clock but not Postgres's — so no
request was actually served at 23:30 on a fall-back day. What *is* directly measured is the date
arithmetic itself, which is where the defect lives.
