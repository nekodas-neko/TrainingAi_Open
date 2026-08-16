# 2026-08-08 — Date-handling hardening sweep

**Domain:** platform / app-shell — v1.270.9, JS-only (no APK rebuild)

Q-130, from the 2026-08-07 full-app review (§3.15, §3.16, §4). Every current caller happens to send
dashed `todayInTz()` output, so all of this is latent — but each failure mode has cost a release
before, which is the whole reason the rules exist.

## (a) Four routes took a raw `date` param with no guard

`mood`, `day-checkin`, `nutrition/food-logs` and `oura/hr-window`. Five sibling routes (`day-log`,
`day-timeline`, `oura/hr-day`, `training-stress`, `workout-sessions/day`) already carry
`normalizeDateParam`. `oura/hr-window` was the worst of the four — it did
`dateParam.split('-').map(Number)` **on the raw value**, the exact `RangeError: Invalid time value`
shape the rule exists to prevent — so it also got a `HH:MM` check on `startTime`/`endTime`, which
were split into `Number()` the same way.

`food-logs`' **POST body** date got the guard too, not just the GET query param: that one becomes
the written row's key, and a bad value files the log under a day nothing can recover.

`day-checkin`'s `phase` param reached the repo unvalidated as well — now a 400 rather than an
arbitrary lookup key.

## (b) `formatDateDisplay` did what the function below it documents as forbidden

`packages/shared/src/date-utils.ts` — `new Date(raw.replace(/\//g,'-'))` parses as **UTC midnight**,
then renders with `toLocaleDateString` in the **device's** timezone. `formatDayShort`, immediately
below it, carries the comment *"never `new Date(isoDay)`, which parses as UTC midnight and shifts
the day in AEST."* Now component-wise, matching its neighbour.

Fixing the shared helper fixes both live callers (`overview-screen.tsx`, `workout/utils.ts`) without
touching either. One of the three inline duplicates —
`app/session-select/components/recommendation-card.tsx` — is fixed here too.

## (c) Dash-only date regexes in 7 files, and one slash-only

`day-checkin`, `ai/health-insight`, `validation/activity-log.ts`, `validation/fitness-test.ts`,
`sync/mutation-schema.ts`, `sync-health`, `admin/timing-baseline` all accepted dashes only, while the
client's `localDateString()` emits **slashes** — a mismatch that killed the ai-chat `localDate` for a
full release, because the Zod gate rejects the request before the handler ever runs.
`health-connect/ingest` had the mirror problem (slash-only, so a dashed date from Tasker would
bounce). All eight now use the `[-/]` form that `validators/chat.ts` and `validation/body-metrics.ts`
already model.

## (d) `sync/pull`'s `since` cursor was unvalidated

A malformed cursor became `Invalid Date`, threw inside `getSyncDelta`, and came back as the generic
500 — so a device with a corrupted cursor retried forever against an opaque server error. Now a 400
that names the param.

## (e) A banned window anchor in `workout/exercise-hr-trend`

`Date.now() - days * 86_400_000` straddles two local days and merges them into one bucket (session
62's bug). Re-anchored at `todayMidnightUtc(tz)`.

## Deliberately not done

Two of `formatDateDisplay`'s three inline duplicates were left alone, both for territory rather than
technical reasons: `components/health/strength-trend-card.tsx` is in `components/`, another agent's
area this batch, and `app/stats/stats-content.tsx` is a **deletion candidate under Q-136** (389
lines, zero importers) — editing a file another agent may be deleting is how conflicts get made. Both
are noted in the PR.

## Verification

`tsc --noEmit` clean · `eslint` matches the pre-existing baseline (48 warnings before and after) ·
full suite 408 files / 3233 tests, one failure (`scale-ble-multi-reading.test.ts`) that **also fails
on a stashed clean tree** — needs a second user row the local seed lacks. Pre-existing, unrelated.

Three new `formatDateDisplay` tests. **Their limit is stated in the test file itself:** CI runs in
UTC, where the old implementation also produced the right day, so the assertions only bite west of
UTC. Verified by running that file under `TZ=America/New_York` — **2 failed before the fix, 27 passed
after**.

**Live-verified every new guard against `pnpm dev`**, valid and invalid input for each:

| request | result |
|---|---|
| `/api/mood?date=2026-08-08` · `?date=2026/08/08` | 200 (both separators) |
| `/api/mood?date=garbage` | 400 `Invalid date` |
| `/api/day-checkin?date=2026-13-45` | 400 `Invalid date` |
| `/api/day-checkin?phase=noon` | 400 `Invalid phase` |
| `/api/nutrition/food-logs?date=2026/08/08` · `?date=oops` | 200 · 400 |
| `/api/oura/hr-window?date=oops&…` | 400 `Invalid date` |
| `/api/oura/hr-window?date=2026-08-08&startTime=7&…` | 400 `Invalid startTime or endTime` |
| `/api/sync/pull?since=garbage` · valid ISO | 400 `Invalid since cursor` · 200 with a real delta |
| `/api/workout/exercise-hr-trend?…&days=30` | 200 |

**Not exercised:** no on-device run — server-side validation and a shared display formatter, no
native, safe-area or gesture surface. The `formatDateDisplay` fix is only observable on a device set
to a timezone behind UTC, which the owner's S25 is not.
