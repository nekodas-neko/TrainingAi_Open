# 2026-09-24 — RV-176: the timezone rule's escapes, one medium and twelve latent

**Branch:** `fix/rv176-timezone-escapes` · **Lane B** (LB-143)

Review sweep 58 found thirteen client surfaces deriving a date, a month or an hour from the device's
clock rather than the user's timezone. All are invisible while the phone sits in Brisbane, which is
why they survived the timezone rule, the two Custom Rules checks meant to enforce it, and months of
daily use.

## The medium

`components/health/health-score-detail.tsx` keyed its whole day to `todayInTz(DEFAULT_TZ)` —
Brisbane, for every user. That one `today` feeds three things: the offline seed's local-store
lookup, the row it picks out of that read, and the date the AI insight card asks for. A user west of
Brisbane asks for tomorrow's insight and seeds from a day that has not happened.

The heart-rate detail screen had the identical bug and was fixed in place rather than filed, so its
`useUserTimezone()` shape is copied here verbatim — including the reason its own comment gives, that
placing buckets in one zone while asking for another's date is what put a Brisbane morning on screen
as an afternoon.

## The twelve latent

- **One device-local clock render** — `exercise-detected-card.tsx` hand-rolled a 12-hour formatter
  off `getHours()`. Replaced with `formatTimeOfDay(ms, tz)`.
- **Seven day-window starts** built from tz-less `todayMidnightUtc()` + `toAestDay()` across
  `session-select-content.tsx` (×3), `log-value-sheet.tsx`, `metric-log-sheet.tsx`,
  `health-content.tsx` and `sleep-content.tsx`. Every one of those files already held
  `const tz = useUserTimezone()` and simply did not pass it — the shape CLAUDE.md warns about, where
  a default every caller is supposed to override is what makes forgetting silent. In
  `sleep-content.tsx` the hook was declared *below* the effect that needed it, so it moved up and
  the effect gained `tz`; two other effects needed `tz` adding to their dependency arrays.
- **Four calendar-month cache keys** from `new Date().getMonth()` —
  `session-select-content.tsx` (×2), `workout-screen.tsx`, `calendar-widget.tsx` — plus
  `year-review-content.tsx`'s trailing-12-month axis. On the first or last day of a month the device
  and the user disagree for up to ten hours, so a screen seeds from, or writes to, a key for a month
  the user is not in.
- **Four meal-bucket picks** from the device hour, in `nutrition-content.tsx`,
  `food-logger-sheet.tsx`, `saved-meals-sheet.tsx` and `assign-step.tsx` — now
  `Math.floor(secondsSinceLocalMidnight(tz) / 3600)`. `assign-step.tsx` additionally re-implemented
  `mealTypeForHour` inline **twice**, which is the One Formula break the entry flagged; both now call
  the shared one, whose `?? [0]` fallback matches what the copies did.

## One new helper, and why it exists

`lib/calendar-month.ts` — `calendarMonthInTz(tz)` and `previousCalendarMonth(m)`. Four sites needed
the same derivation and a fifth needed the month before it, so hand-rolling it at each would have
been the duplication this repo treats as a bug by definition. The back-step uses `Date.UTC` overflow
rather than adjusting the year by hand, per the rule that produced `2026-06-31` and a 500 (#23).

It sits in `lib/` rather than `packages/shared/src/date-utils.ts` because that file is Lane A's.
Nothing under `app/api/**` reaches it, so the path rule puts it on Lane B — recorded as a claimed
path in the baton rather than assumed, since a bare `lib/*.ts` module is the ambiguous case.

## Verification

`lib/__tests__/rv176-timezone-escapes.test.ts` — 8 tests. Three drive the new helper (the December
underflow, the zero-pad the cache key depends on, month bounds in two zones 26 hours apart). Five
scan every client `.tsx` and would fail on a reintroduction.

**Control run:** with `app/` and `components/` reverted, 5 of the 8 fail; restored, 8 pass.

Two traps the scanner documents, both of which cost a round here:
- It **strips comments first**. Several of these fixes explain themselves by quoting the pattern
  they replaced, so a scanner that reads comments flags the fix as the defect.
- Arity is **per function**: the tz is `todayMidnightUtc`'s first argument but `toAestDay`'s second.
  A regex cannot express it either — `toAestDay\([^,)]+\)` matches the *corrected*
  `toAestDay(new Date(x), tz)` by stopping at the inner paren, so the check balances parens and
  counts commas at the call's own depth.

Local gates: `pnpm check:rules` **Ran 78 of 78, all passed** · `tsc --noEmit` clean ·
`check-test-typecheck` none above baseline · lint introduces no new warnings (the two remaining in
`session-select-content.tsx` name `userId` and `dayKey` and were confirmed present on `main`) ·
2,742 tests pass across the three touched suites.

**Not exercised: the device, and any timezone but Brisbane.** Every one of these is by construction
invisible at `Australia/Brisbane`, which is the only zone the owner's phone has been in — so the
behaviour change is reasoned and test-scanned, not observed. The honest statement is that the
*escapes* are gone, verified by source; that a user in another zone now gets the right day is
implied by the helpers, not measured.

## Left open

The two Custom Rules blind spots that let this class through are **RV-179** (`Lane: O`) and did not
close here. Nothing in CI catches a reintroduction; the vitest scan above is what holds it at zero
in the meantime, and RV-179 now says so, so widening those scripts can shrink this file rather than
duplicate it.

`components/profile/personal-details-section.tsx` keeps `new Date().getFullYear() - 10` as a
date-of-birth bound. Device and user disagree about the year for a few hours once a year, on a bound
that already carries a decade of slack — not a defect, and the test asserts it as the one expected
name rather than silently skipping it.
