---
name: timezone-handling
description: Use this skill any time code constructs, compares, formats, or stores a date or "today" value — new API routes, cache keys, DB writes for food/body/mood/workout logs, streak or date-range calculations. ALWAYS check this skill before writing `new Date().toISOString()` or `new Date().toISOString().slice(0,10)` anywhere. Also trigger when debugging "shows yesterday's data before 10am", "wrong date logged", "streak reset incorrectly", or any bug mentioning midnight, UTC, or AEST.
---

# Timezone-Correct Date Handling (AEST / GMT+10)

This is the single most-repeated bug category in TrainingAI's history (see changelog 1.5.2, 1.8.3, 1.15.0, 1.19.0, 1.21.0, 1.25.4, 1.31.0 — all fixed the same root cause in different places). The app's user is in `Australia/Brisbane` (AEST, GMT+10, no DST). UTC and AEST diverge by 10 hours, so any UTC-based "today" is **yesterday's date** until 10am AEST.

## The forbidden pattern — grep for this before committing

```ts
new Date().toISOString().slice(0, 10)   // UTC date
new Date().toISOString().split('T')[0]  // same problem
new Date().getDate() / .getMonth() / .getFullYear()  // local-to-server-TZ, not user TZ
```

## The correct toolkit — `lib/date-utils.ts`

| Function | Returns | Use for |
|---|---|---|
| `todayInTz(tz?)` | `'YYYY-MM-DD'` in `tz` (default `Australia/Brisbane`) | "Today" everywhere — cache keys, DB writes, date params |
| `toAestDay(date, tz?)` | `'YYYY-MM-DD'` for an arbitrary `Date` | Converting a timestamp to its local calendar day |
| `toAestDateStr(date, tz?)` | `'YYYY/MM/DD'` | Sheets-era display format (legacy, rarely needed for new code) |
| `todayDayOfWeek(tz?)` | `0`=Mon … `6`=Sun | Schedule/rotation day lookups |
| `fmtAest(ms, tz?)` | `'8:30am'` | Displaying a timestamp as local time |
| `todayMidnightUtc(tz?)` | UTC `Date` for local midnight today | "N days ago" arithmetic — see below |

## Rules

- **API routes**: a `date` query param defaults via `formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')` where `tz = session.user?.timezone ?? DEFAULT_TZ`. Never default to `new Date().toISOString().slice(0,10)`.
- **Client components writing a date** (food logs, body metrics, mood, activity logs): call `todayInTz()`, never `new Date().toISOString()`.
- **"i days ago" arithmetic**: don't do `Date.now() - i*86400000` — at 9am AEST that's 19 hours into "yesterday UTC", not "yesterday AEST". Instead start from `todayMidnightUtc(tz)` and subtract whole days.
- **Cache keys** that embed a date (e.g. `nutrition-food-logs-<date>`) must use `todayInTz()`, otherwise the cache key itself silently drifts a day at the UTC boundary.
- `session.user.timezone` is stamped into the JWT at login (default `Australia/Brisbane`, user-configurable in Profile) — always prefer it over the hardcoded default when a session is available.

## Self-check before committing any date-related code

> Am I using `todayInTz()` (or another helper from `lib/date-utils.ts`)? If the answer is no, fix it now — this bug class is invisible in testing during the day and only manifests before 10am AEST.
