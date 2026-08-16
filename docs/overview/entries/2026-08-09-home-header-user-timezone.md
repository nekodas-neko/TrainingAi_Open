# 2026-08-09 — The home header greets you by your own clock (Q-163)

**Branch:** `fix/client-header-user-timezone` · **Domain:** `app-shell` · **v1.275.1**

## What was wrong

Four client render sites passed `DEFAULT_TZ` rather than the signed-in user's timezone, so anyone
outside Brisbane saw another zone's day presented as their own. The review observed a seeded
`America/New_York` user at 18:52 their time being shown **"Sunday 9 August"** (Brisbane's date, a day
ahead) and **"Good morning."**

This is the **fourth** appearance of the class, after Q-73, Q-144 and Q-148. Every prior fix was
correct; none covered these sites.

## It was six sites, not four

The entry listed four. Reading the files turned up two more, and both were load-bearing:

5. **`session-select-content.tsx:376`** — the calendar-day key built from local-store history,
   `formatInTimeZone(session.startedAt, DEFAULT_TZ, 'yyyy/MM/dd')`. These keys have to match the ones
   `aestDateString()` produces, because both fill the same `calendarDays` map. Changing one without
   the other would have made the week strip and the local-history fill disagree by a day — a *new*
   bug shipped inside the fix for the old one.
6. **`app/workout-select/workout-select-content.tsx:22`** — a second, independent copy of the same
   `aestDateString` helper, hardcoded the same way.

`overview-screen.tsx` also had a bare `todayInTz()` (no zone) keying a **body-metric write**, which
is the same defect on a write path rather than a display one.

## The comment was half the bug

`session-select-content.tsx:99-100` carried:

> the server buckets workout/rest days in AEST regardless of device timezone, so the client must key
> off the same source

That was true when written. **Q-144 (#1161) made it false** by moving `getCalendarData` and
`getRecentTrainedDays` onto the user's zone. So the hardcode looked deliberate and justified, and
three subsequent fixes of this exact class left it alone. It is deleted, and the replacement says
what changed and why — leaving it is how this survives a fifth time.

## What changed

`dayKeyInTz(tz, daysAgo, at?)` now lives once in `packages/shared/src/date-utils.ts`, replacing both
hardcoded copies. The prop threaded into `recommendation-card` and `streak-card` was renamed
`aestDateString` → `dayKey`, because a name that says AEST is the same trap as the comment.

`useUserTimezone()` (from Q-148, which shipped the provider that none of these sites used) supplies
the zone in all six places.

## Paying for the growth rather than raising the baseline

The component-size ratchet failed the first attempt: `session-select-content.tsx` went 1484 → 1485
lines. Rather than bump the baseline, extracting the duplicated helper into `date-utils` took both
copies out — the file shrank, the duplication went away, and the ratchet passes untouched. That is
what Q-138's "pay for hotspot growth by extracting" is for.

## Verification — three zones, because two cannot prove it

Per the lesson from Q-148: with only two zones, "device-local" and "the `DEFAULT_TZ` fallback" are
indistinguishable from "the user's zone". So: user profile `America/New_York`, browser
`Europe/London`, fallback `Australia/Brisbane`. At the moment of the run those gave three *different*
hours — 08, 13 and 22 — so the greeting is a clean discriminator even though all three shared a date:

```
rendered greeting : "Good morning, Test User."     <- New York, the user's own zone ✅
                    ("Good afternoon" = device bug, "Good night" = the old DEFAULT_TZ bug)
```

Then the bug was planted back (`getGreeting` hardcoded to Brisbane) and re-run:

```
rendered greeting : "Good night, Test User."       <- reproduces exactly
```

A New York user at 08:40 their own time being told "Good night" is the same defect the review
reported from the other side.

- `tsc --noEmit` clean · `eslint` 0 errors · full suite **424 files / 3386 tests** green · all
  custom-rule scripts pass, including the component-size ratchet.
- Four new `dayKeyInTz` tests pin the zone-straddling case with an **injected clock** — a
  zone-straddling assertion against the real clock only fails during the hours it straddles, which
  is the rolling-window trap CLAUDE.md already records.

## Not exercised

**The device.** These are all Home-screen surfaces on the APK and nothing ran on the S25. Also not
changed: the ~8 `toAestDay`/`todayMidnightUtc` calls doing 14/30/90-day *query-window* math rather
than display — the same call the Q-148 session deliberately left alone, since re-keying them churns
caches for nothing visible.
