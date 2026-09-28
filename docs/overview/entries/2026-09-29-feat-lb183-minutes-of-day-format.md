# 2026-09-29 — LB-183: one time-of-day form, and a helper for minutes-of-day values

**Lane A · `packages/shared/src/date-utils.ts`.**

- **`formatMinutesOfDay(minutes)`** prints a minutes-since-midnight value in exactly the form
  `formatTimeOfDay` uses for an instant ("6:40 am"). It rounds the whole value before splitting it,
  so 419.6 is "7:00 am" rather than the "6:60" that `clockLabel`'s minute-only rounding can
  produce, and it wraps into one day.
- **`formatTime12h`** now delegates to it. The activity list and activity sheet read "6:40 am", and
  the fourth form ("6:40am") is gone.
- **Tests:** the new helper and `formatTime12h` are asserted equal to `formatTimeOfDay` for the same
  Brisbane wall time at four points (morning, noon, midnight, 23:59), plus rounding, wrap and NaN.
- **Left for Lane B (LB-183, re-laned):** point `formatClock` and `clockLabel` at the helper.
- **Not exercised:** a browser pass. It is a pure formatter, covered by unit tests.
