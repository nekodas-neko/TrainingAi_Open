# LB-95 — the one thing the app measured and gave no way to read

**Branch:** `feat/lb95-personal-records-overview` · **Version:** 1.484.0

Lane A built `GET /api/personal-records` on 2026-09-28. Re-verified against `main`: the route exists
and returns `{ records: [{ exerciseName, estimated1rm, achievedAt }] }` exactly as the entry
describes — every exercise, not filtered to the active program, newest first.

This is the surface: a **Lifting** section on More → Details, in the `readingGroups` shape the two
sections above it already use.

## The one real trap: `achievedAt` is an instant

The other readings on this screen carry a calendar day. A personal record carries the **instant** the
set was logged, so the day has to be resolved in the user's zone — `toISOString().slice(0, 10)` would
print the UTC day, which is yesterday for every record set before 10am here.

`personalRecordReadings` goes through `toAestDay(new Date(achievedAt), tz)`, and both the unit test
and the e2e pin the case that matters: **23:30Z on the 29th is already the 30th in Brisbane.** The
e2e asserts `2026-09-30` is present *and* `2026-09-29` is absent, so a UTC slice fails it rather than
passing by coincidence.

## Decisions

- **Its own section, not rows in the daily one** — the reason the tests-and-scans section states:
  each half has to render when the other has nothing.
- **Last on the screen**, because it is the only section that grows on its own. A new record appears
  the moment a set beats the old one; a scan or a test does not.
- **"estimated 1RM" on every row.** These are computed from a logged set through the 1RM formula and
  were never lifted at that weight. Printing a bare number would present a formula's output as a
  performance.
- **A record with no usable number is dropped**, not rendered as `NaN kg`.
- **`TTL_LONG` raw rather than a named constant.** The rule asks for one in `cache-ttl.ts` at two or
  more call sites; this has one, and inventing a constant would put a Lane A edit into a Lane B
  change for no freshness benefit.

## Cross-lane note

One additive line in `lib/cache-groups.ts` (Lane A's): `personal-records` joins
`invalidateWorkoutSummaries`, because a logged set can set a new record and without it the new
number waits out the key's TTL on the one screen that lists it. Same judgement as TN-46's two lines,
recorded for the same reason.

## Verified

- `components/more/details/__tests__/lb95-personal-records.test.ts` — **6 tests**, including the
  same instant resolving to different days in Brisbane and New York, the naive UTC slice asserted as
  the wrong answer, and the empty-group case the section's `null` return depends on.
- `e2e/lb95-personal-records-overview.spec.ts` — **2 tests** at 412 px dark against the real screen,
  payload injected (the seeded user has no record, and the section returns null with none, so every
  assertion would otherwise pass vacuously). Covers the rendered rows, the timezone case, and the
  section being absent when nothing is logged.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors ·
  `pnpm test` **9,528 passed** · `pnpm build`.
- Three date literals are exempted in `check-e2e-stub-dates.js` **with stated reasons**: a record's
  date is the instant it was set and nothing compares it to today, so both sides of the assertion are
  fixed — which is the one condition the rule allows.

## Not exercised

- **Real records.** The seeded user has none, so this has only been drawn against an injected
  payload; the exercise names and weights in it are fixtures.
- **The invalidation firing.** That a completed workout clears `personal-records` is asserted by the
  group's own test, not by observing a record appear after a set.
- **The device.** No native, safe-area or gesture change.
