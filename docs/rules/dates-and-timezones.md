# Dates and timezones

> Moved verbatim from `CLAUDE.md` on 2026-10-05, when it was cut from 121 KB to the short form (release train, Phase 4). `CLAUDE.md` keeps each rule as one line pointing here; **this file keeps the reasons and the incidents behind them**, which is what makes a rule hold. Some passages describe the retired seven-agent process (lanes, batons, the backlog file) — where they do, the rule they carry still stands and the mechanism around it is history.

## Timezone — All Dates Must Use the User's Timezone (AEST / GMT+10 by default)

**This is a strict rule.** The app user is in AEST (GMT+10). UTC and AEST dates diverge by 10 hours, so using UTC to get "today" produces yesterday's date before 10am AEST every single day.

### The forbidden pattern — never write this anywhere:
```ts
new Date().toISOString().slice(0, 10)   // ❌ returns UTC date — wrong before 10am AEST
new Date().toISOString().split('T')[0]  // ❌ same problem
d.toLocaleTimeString('en-AU', { … })    // ❌ renders in the DEVICE's timezone, not the user's
d.toLocaleDateString('en-AU', { … })    // ❌ same — both need an explicit `timeZone`
```

**`toLocale*String` without a `timeZone` option is the same bug wearing a different hat**, and it
hid for months because it is invisible while the device sits in the zone the data was recorded in.
Found 2026-08-03 while investigating a reported wake-time shift: six user-facing screens — the sleep
list, the hypnogram axis, the sleep card, the activity review sheet (×2) and scale pairing — rendered
clock times in device-local. On a phone set to New York a 7:05 am Brisbane wake read as **5:05 pm**.
Use `formatTimeOfDay(at, tz?)` from `@trainingai/shared/date-utils` for a time of day; it is the one
place that decides how a clock time is rendered. Admin/debug consoles under `components/oura-ble/`
and `components/admin/` are deliberately exempt — device-local is the useful reading when you are
holding the device.

### The correct pattern — always use these instead:
```ts
import { todayInTz } from '@trainingai/shared/date-utils'    // server + client
todayInTz()                                      // returns 'YYYY-MM-DD' in user's timezone

// If you have the user's timezone from the JWT session:
todayInTz(session.user.timezone)                 // dynamic, respects user's Profile setting
```

### Rules:
- **Every place a date string is constructed** (API routes, client components, cache keys, DB writes) must use `todayInTz()` or another helper from `packages/shared/src/date-utils.ts`.
- **API routes** that receive a `date` query param should default to `formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')` where `tz = session.user?.timezone ?? DEFAULT_TZ`. Never fall back to `new Date().toISOString().slice(0,10)`.
- **Client components** that write a date to the API (food logs, body metrics, mood logs, etc.) must call `todayInTz()`, not `new Date().toISOString()`.
- The user's timezone is stored in the DB (`users.timezone`) and stamped into the JWT at login — it is available as `session.user.timezone` in all API routes. Default is `'Australia/Brisbane'` (AEST, no DST).

### Why this keeps happening:
`new Date().toISOString()` is the obvious, well-known way to get the current time in JavaScript. It's what every tutorial shows. The timezone-aware alternative is app-specific and not visible unless you know to look for it. **Whenever writing any code that needs the current date, stop and ask: am I using `todayInTz()`?** If the answer is no, fix it before committing.

---

## Date Arithmetic — beyond todayInTz()

The timezone rule covers "today"; this covers **ranges and construction**, which kept breaking after "today" was fixed:

- Never hand-add to calendar components — `aestMidnight(y, m, d+1)` built `2026-06-31` and 500'd the workout screen on every month-end (#23); `d-90` went negative. Use `Date.UTC` overflow normalisation or a `packages/shared/src/date-utils.ts` helper.
- Range/window starts anchor at the user's **local midnight**, never `now − N×86400000` — ms-offset windows straddle two AEST days and merge them (session 62).
- Any SQL/JS window boundary (day buckets, week starts, "since midnight") is computed in the user's timezone; give new date aggregations a boundary test at 23:59/00:01 user-local.
- Validate any `new Date(string)` built from DB/API values — `HH:MM:SS` vs `HH:MM` parsing silently dropped timeline events (#54).
- **Every API route that accepts a `date`/`localDate` param routes it through `normalizeDateParam` (`packages/shared/src/date-utils.ts`) before any date arithmetic.** A raw param reaching `split('/')`/`aestMidnight` is a 500 (`RangeError: Invalid time value`). The session-212 fix covered only `/api/day-log`; the 2026-07-06 review found the same gap in `day-timeline`, `workout-sessions/day`, `oura/hr-day` and the ai-chat `localDate` — new routes get the guard at creation.
- **A date-param Zod schema must accept BOTH separators — `z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/)`, never dash-only `/^\d{4}-\d{2}-\d{2}$/`.** The client's `localDateString()` (`packages/shared/src/utils.ts`) emits **`YYYY/MM/DD` with slashes**, and handlers normalise slashes→dashes (`.replace(/\//g,'-')`) — so a dash-only schema rejects **every** real request with a Zod `invalid_format` error *before the handler runs*, and the failure is invisible until a client that fills the param from `localDateString()` calls it. This bit `ai-chat`'s `localDate` for a full release (2026-07-19: chat + any localDate-bearing AI call returned a raw Zod error). The `body-metadata` route's `[-/]` regex is the reference. This is the schema/handler-agreement flavour the `normalizeDateParam` rule above does NOT cover — that rule guards the *handler*; this guards the *validation gate* in front of it. When adding a client-facing date param, grep the client for whether it's filled via `localDateString()` (slashes) before writing the regex.
- **A test may hardcode a timestamp only when BOTH sides of the comparison are fixed.** The moment
  one side is the real clock, an absolute date is a time bomb with a known detonation date.
  `scale-ble-day-keying.test.ts` pinned its input to `2026-07-27T22:00:00Z` and let the route call
  `resolveMeasuredAt(measuredAt)` with its default `now` — so at **22:00 UTC on 2026-08-03** the
  fixture crossed `INGEST_PAST_TOLERANCE_MS` (7 days), got clamped to "now", and the test began
  failing on every branch including `main`. Its siblings were fine for exactly this reason:
  `sensor-ingest-reconciliation.test.ts` passes an explicit `now` in, and
  `complete-workout.test.ts` derives both sides from `Date.now()`. **Derive the fixture from the
  clock (`now − 2 days`) or inject the clock — never hardcode one side of a rolling window.** This
  is a different failure from the hour-dependence rule below: that one fires twice a day, this one
  fires once and then stays red forever.
- **Deriving BOTH sides from the clock is not enough if they come from different timezones** (Q-356,
  2026-08-18). `periodization-soft-delete.test.ts` inserted at `now() - interval '2 hours'` — a UTC
  offset — and queried a window derived from the *user's* timezone. Between 00:00 and 02:00 Brisbane
  (14:00–16:00 UTC) "two hours ago" is the previous local day, so the row fell outside the window and
  **the whole file went red, 21 of 21, on every branch, for two hours every day**. It survived weeks
  because it only fired in that window. Two correct shapes: compute the user-local day **first** and
  anchor the fixture to **midday on that day** (midnight is a boundary, and a boundary is where an
  off-by-one stops being visible), or read the local day **back from the row you just inserted**, as
  `oura-workout-soft-delete.test.ts` does. And a regression test for this class must not wait for the
  window — pick a fixed-offset zone (`Etc/GMT±N`) whose local time is *currently* near 01:00 and run
  the case there, so it fires on every CI run. `faketime` does not help: it shifts node's clock, not
  Postgres's.
- **`aestMidnight(y, m, d)` without its fourth argument keys the window to Brisbane, for every
  user.** The parameter exists and defaults to `DEFAULT_TZ`, which is right for the owner and wrong
  for everyone else — the same "a default every caller overrides is a safety net" shape as the repo
  day-window helpers below. It was **9 of 22** on 2026-08-23; all 22 pass one now (LA-19), and
  `scripts/check-aest-midnight-timezone.js` holds that at zero in the Custom Rules job — its
  baseline is **empty**, so an omitting call site is a regression rather than a debt row. It surfaced from a test that was written correctly — it read the local day
  back from the row it had inserted — and still failed, because the query re-derived midnight in
  Brisbane. **To find this class, do not read: shift a test user's timezone into its own 00:00–02:00
  band** (an `Etc/GMT±N` computed from the current UTC hour, as
  `local-day-fixture-anchoring.test.ts` does) and re-run. That reproduces the hazard on any clock,
  which is the whole reason it survives otherwise.
- **Client code has two "today" sources** — `todayInTz()` vs the device's own timezone. Pick one per feature and don't mix them for keys that must match server bucketing. Repo day-window helpers (`getCalendarData`, `getRecentTrainedDays`, `getNextSession`) take `timezone = DEFAULT_TZ` as a **default parameter** and every current caller passes the session tz — they are the pattern to copy, not a known-broken area (Q-480). Keep threading it when touching them: a default every caller overrides is a safety net, and it is what makes forgetting silent. Never re-declare `DEFAULT_TZ` locally.

---
