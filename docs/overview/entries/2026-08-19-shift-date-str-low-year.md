# 2026-08-19 — a first-century date no longer jumps ~1,900 years (Q-329)

**Branch:** `fix/shift-date-str-low-year` · **Lane:** Implementation A

## The defect

`Date.UTC` applies the legacy two-digit-year mapping: a year of 0–99 is read as 1900+y. So
`shiftDateStr('0001-01-01', -1)` returned **`1900-12-31`** instead of `0000-12-31` — silently, and on
a value the app's own validation accepts, since `normalizeDateParamIso`'s regex is `\d{4}` and
`0050-01-01` passes it.

Found while fixing Q-497 and filed rather than folded in, because that change was about loop
termination and mixing a date-helper rewrite into it would have made the loop fix harder to review.

## The decision the entry left open

Q-329 named two routes and said to pick before building:

- **reject a year below 1000 at `normalizeDateParam`** — the value never reaches any helper, but it is
  a validation change across **42 routes** that use it;
- **fix the helper** — one file, no validation contract changes.

**The helper wins on blast radius and on being the root cause.** The bad value comes from `Date.UTC`,
not from the parameter, so correcting it where it is produced is the one-formula-one-place answer;
tightening 42 routes' validation would leave the same trap live for any non-route caller.

## What shipped, and the rewrite that was tried first and rejected

```ts
if (y >= 0 && y < 100) shifted.setUTCFullYear(shifted.getUTCFullYear() - 1900)
```

A deliberate *correction*, applied only to the affected range, leaving every ordinary year on the path
the existing 40 tests already cover.

**The tempting rewrite is wrong and there is now a test that says so.** Constructing in a safe year
and re-stamping the real one —

```ts
const shifted = new Date(Date.UTC(2000, m - 1, d + days))
shifted.setUTCFullYear(shifted.getUTCFullYear() - 2000 + y)
```

— looks cleaner and has no conditional, but it **breaks `2026-03-01` minus one day**: the intermediate
lands on 2000-02-29, and re-stamping a non-leap year rolls it forward to March 1 instead of back to
February 28. `shiftDateStr('2026-03-01', -1)` is now an explicit case beside the low-year ones so the
next person who reaches for that shape fails immediately rather than shipping it.

## Verified

```
shiftDateStr('0001-01-01', -1) → 0000-12-31   (was 1900-12-31)
shiftDateStr('0050-06-15',  1) → 0050-06-16
shiftDateStr('0099-12-31',  1) → 0100-01-01   (crosses out of the mapped range)
shiftDateStr('0100-01-01', -1) → 0099-12-31   (crosses into it)
shiftDateStr('2026-03-01', -1) → 2026-02-28   (the common path, unchanged)
shiftDateStr('2024-03-01', -1) → 2024-02-29   (a real leap day, unchanged)
```

All 40 pre-existing `date-utils` cases still pass, 43 now. Full suite **4,336 tests, 0 failed**;
`tsc` clean; `pnpm check:rules` **Ran 50 of 50**.

## Residual, stated rather than left

**Year 0's February 29 is still slightly off.** Year 0 is a leap year in the proleptic Gregorian
calendar and 1900 is not, so the intermediate `Date.UTC` value rolls before the correction can apply.
Left alone deliberately: reaching it requires a first-century date param on an admin route, and the
alternative constructions all break a common-path case, which is a far worse trade.

**Not exercised:** no route was driven — the defect is in a pure helper and its call sites are covered
by their own suites. Nothing on device, no production data.
