# 2026-08-08 — Calendar and streak now bucket by the user's own timezone (Q-144)

**Branch:** `claude/token-usage-strategy-7cx7z9` · **Domain:** `platform`

## What was wrong

Three sites carried a `TODO(tz): thread session tz — DEFAULT_TZ assumed (app is AEST-only in
practice)` comment. That premise stopped being true: per CLAUDE.md's 2026-08-02 amendment other
people already have accounts, and a Play Store listing is intended.

The two that mattered were `getCalendarData` and `getRecentTrainedDays`, which hardcoded
`AT TIME ZONE 'Australia/Brisbane'` in SQL. **20:00 in New York is already the next day in
Brisbane**, so an evening workout appeared on the calendar and the streak a day late — measured at
**14 of every 24 hours** for a New York user, i.e. most training hours.

`getCalendarData` also built its upper window boundary as `Date.UTC(year, month, 1) - 10 * 60 * 60 *
1000` — a hand-rolled AEST offset, and the kind of manual calendar arithmetic CLAUDE.md bans after it
produced `2026-06-31` and a 500 on the workout screen (#23).

The third site, `getOuraWorkouts`'s `unreviewed` branch, used `todayInTz(DEFAULT_TZ)` for its 30-day
lookback — same class, smaller blast radius.

## The fix

`timezone` is now threaded from the session through all three. The two repository methods take it as
a defaulted parameter (`DEFAULT_TZ` preserved, so nothing else had to change), `getOuraWorkouts`
takes it in its existing `opts`, and the three routes — `calendar-data`, `streak-data`,
`oura/workouts` — pass `session.user.timezone`, which was already on the JWT the whole time.

The hand-rolled offset is gone: the window is now `aestMidnight(year, month + 1, 1, tz)`, which
normalises month overflow, so December → January rolls correctly instead of relying on arithmetic
that only worked at UTC+10.

Zero `TODO(tz)` markers remain in the tree.

## Verified by mutation, not just by going green

Four tests in `lib/data/postgres/__tests__/calendar-streak-timezone.test.ts`. Reverting the SQL to
the hardcoded zone fails two of them with exactly the original symptom — the workout files under the
Brisbane key instead of the New York one. That is the check that distinguishes a real test from one
that passes because the fixture never landed.

Two deliberate choices in the fixture, both from mistakes made earlier this session:

- **The instant is derived from the clock**, not hardcoded. `getRecentTrainedDays` anchors its window
  on today's local midnight, so a fixed date is one side of a rolling window — precisely the shape
  CLAUDE.md warns about, which took a test red on `main` on 2026-08-03.
- **There is an explicit assertion that the two zones disagree** on the chosen instant. Without it,
  every other assertion in the file is trivially true if the fixture ever stops straddling a day
  boundary, and the suite would keep passing while testing nothing.
- The Brisbane case is asserted too, so "fixed" cannot quietly mean "now wrong for the owner".

## Not exercised

No device or browser — this is server-side only. **No second real account exists in production**, so
this is verified against the local DB, not observed in the wild; the owner's own Brisbane data is
unaffected by construction (same zone in, same buckets out), and that path is covered by the third
test. The other server-side `DEFAULT_TZ` fallbacks outside these three sites were not swept — they
were not part of this entry and each needs its own check for whether a session timezone is even
reachable there.
