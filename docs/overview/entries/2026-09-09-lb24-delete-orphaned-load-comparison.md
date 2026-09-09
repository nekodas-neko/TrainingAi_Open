# 2026-09-09 — deleting the orphaned load-comparison chart, route and cache line (LB-24)

**PR:** `lane-a/lb24-delete-orphaned-load-comparison` · **Lane A** · deletion only, no migration.

## What went

- `components/health/workout-load-comparison-chart.tsx` — zero renderers since Q-112a removed
  `day-review-sheet.tsx`, its only one.
- `app/api/workout-load-history/route.ts` — zero client callers since the same change.
- The `workout-load-history:` line in `invalidateWorkoutSummaries()` (`lib/cache-groups.ts`), which
  had been clearing a key nothing wrote or read.

The entry told me to verify the call sites at the head I delete from rather than trust its note, and
that was right to insist on: the grep found a **test file the entry never mentioned**.
`lib/__tests__/strength-trend-routes.test.ts` covered two routes, and only one of them survives, so
it is now `lib/__tests__/exercise-estimates-route.test.ts` with the load-history half removed. That
is deleting a test alongside the source it tested, not quarantining a test to get green — the
distinction matters and the file's header comment now records where the other half went.

## Why delete rather than re-home

LB-24 deliberately parked itself behind Q-112d, because a tidy-up before the trends phase would be
work that phase might undo. Q-112d shipped and re-homed nothing. It did not reuse the route either:
`/api/day-review/week-window` derives session volume itself from `getWorkoutSessionsFrom`, so
Q-112c's plan text about reusing `/api/workout-load-history` described an intention the shipped route
did not follow. Nothing was left that might rescue either file.

## A stale count found on the way, and not replaced with another one

`projectOverview.md`'s Q-489 entry listed `workout-load-history` as one of three rolling-instant
sites among "12 instances" of the ms-offset shape. The route **as deleted** read
`dateStrMidnightInTz(shiftDateStr(todayInTz(tz), -90), tz)` — the *anchored* form, not the banned
offset the 2026-08-18 review recorded. So it had stopped being an instance some time before it was
removed, and at least one of the 12 was already stale for a reason that has nothing to do with this
deletion.

I first wrote "the count is 11 now, not 12" and that was wrong twice: I had not measured the current
count, and the site I removed was not one of them anyway. The line now says the number is stale and
wants re-measuring, and asserts no replacement — an unmeasured count in an orientation doc is how a
false finding gets born.

## Verification

No mutation pass: there is no new behaviour to mutate. The gate is that nothing references what
went. `pnpm check:rules` 71 of 71 (which includes "every API route has a test that imports its
handler" — the deleted route no longer owes one), full suite green, typecheck clean.

**Not exercised:** nothing on-device. Deleting a component with no renderers and a route with no
callers cannot change a rendered surface, which is the same fact that made it safe to delete.
