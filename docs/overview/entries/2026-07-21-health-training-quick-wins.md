## 2026-07-21 — Health/Training/Workout UX batch: quick wins (v1.188.2)

**Branch:** `fix/health-training-quick-wins` — part of the owner-directed 14-item batch
(plan: `docs/superpowers/plans/2026-07-21-health-training-ux-batch.md`). Five web-verifiable
fixes grouped into one PR (disjoint files):

- **#12 nutrition meal-bucket** — `SavedMealsSheet.quickLog` always computed the bucket from
  `new Date().getHours()` and had no way to receive the bucket the user opened it from, so a
  saved meal quick-logged from "Breakfast" at lunchtime landed in "Lunch". Added a
  `preselectedMealTypeId` prop (forwarded from `FoodLoggerSheet`); `quickLog` now uses
  `preselected ?? time-of-day ?? first`. The bottom, non-bucket-scoped "Saved Meals" button keeps
  the time-of-day default (unchanged).
- **#10b avg session duration** — `weekly-stats` measured duration as the first→last logged-set
  span, which excludes warm-up + final rest and collapses to ~0 when sets are logged in a burst
  (a real 55-min session read ~28 min). Now prefers real wall-clock `completedAt − startedAt`
  (both are real timestamps on `workout_sessions`) with a 240-min plausibility cap to reject the
  case where `startedAt` fell back to local-midnight; falls back to the log-span otherwise. The
  route's "startedAt is midnight AEST" comment was stale.
- **#11a Progress order** — `PROGRESS_DEFAULT_ORDER` now leads with `strengthTrend`, `trends`.
  Because `getHealthCardOrder` returns a user's *saved* order (ignoring a changed default),
  added a one-time reset marker (`ta_health_progress_order_reset_2026_07_21`) in
  `lib/health-card-order.ts` that clears a stale saved progress order once; later manual reorders
  re-persist and survive.
- **#11b Trends card height jump** — the 7-view picker swapped between four different-height
  bodies (loading/error/empty/chart-or-bars + variable insight), making the card jump while
  scrolling. Wrapped the body in a fixed `min-h-[210px]` area and clamped the insight to 3 lines.
- **#13 More cache-seed** — added `readCacheSync` seeds for `more-seasons` (before-paint, in the
  existing layout effect), `program-week`, and `admin-pending-count`, so a repeat visit paints
  from cache instead of flashing empty.

### Verification

- `pnpm exec tsc --noEmit`, `pnpm lint` (0 errors), `pnpm test` (1793 passed) — green.
- `pnpm dev`, authed as `test@local.dev`: **#10b confirmed behaviourally** — after shifting a
  seeded 18:00→18:55 session into the current week, `/api/weekly-stats` `avgDurationMin` returned
  **55** (the exercise-log span was a single point, so the wall-clock path is what produced it).
  `/health`, `/more`, `/nutrition` all render HTTP 200; meal-types buckets intact for #12.

### NOT exercised

- No pixel/screenshot (Playwright not installed; installing would touch the lockfile). #12's
  bucket routing was verified as prop-threading + logic (tsc) and #11a/#11b/#13 as compile + HTTP
  200 + reasoned logic — the visual/interaction result (bucket lands correctly, Progress order,
  no card jump, no flash) is confirmable only in a real browser/on-device.
- Branched off `main` (v1.188.1) in parallel with the unmerged Readiness #1 branch (v1.188.0);
  version bumped to v1.188.2. Expect a version re-bump on whichever PR rebases second.
