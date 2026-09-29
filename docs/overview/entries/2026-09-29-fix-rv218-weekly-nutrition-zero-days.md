# 2026-09-29 — RV-218 ④: the 7-day nutrition chart shows seven days, and averages only the logged ones

**Lane A · `app/api/nutrition/weekly-summary` + `components/nutrition/weekly-nutrition-chart.tsx`, one PR as
the entry required.**

- **Route:** always seven rows, oldest first. An empty day is `logged: false` with zeros, and
  `isToday` is marked by the route, the layer that knows the user's timezone.
- **Chart:** its rules live in `components/nutrition/weekly-nutrition-days.ts` → `weeklyChartModel`.
  - The average covers logged days only, labelled "avg of N logged days", because an unlogged day is
    not a 0 kcal day.
  - The empty state shows when nothing was logged.
  - Today's bar is emphasised, not the last one; with gaps, the last bar was yesterday on any morning
    before the first log.
  - A cached payload from before this change (no `logged`, no `isToday`) is read as all-logged with
    the last row as today, so first paint is unchanged until revalidation.
- **Verified:** a route test (seven rows, one today, zeros on unlogged days), helper tests including
  the old cached shape, and `pnpm dev` on the owner's snapshot at 384 px. That showed seven bars
  (Wed to Tue), zeros on Fri, Mon and today, and "avg of 4 logged days: 745 kcal". The old average
  would have divided by 5 rows.
- **RV-218 still open:** ① waits on LA-180 (the owner's calorie-number question) and ② (one "burned"
  function).
