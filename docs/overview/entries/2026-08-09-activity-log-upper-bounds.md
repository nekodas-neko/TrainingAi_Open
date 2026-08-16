# 2026-08-09 — A walk can no longer last 69 days (Q-164)

**Branch:** `fix/unbounded-numeric-validators` · **Domain:** `activity`, `platform` · **v1.275.2**

## What was wrong

`POST /api/activity-logs` with `durationMin: 100000` returned **201 Created** and persisted a single
walk lasting 69.4 days. Every numeric in `packages/shared/src/validation/activity-log.ts` was bounded
below and open above — 28 of them.

## Why the cross-field check could not catch it

The file already had a `superRefine` calling `activityImplausibleReason`, added for the "420 km in
1 minute at 900,000 kcal" case. It doesn't help here, and the reason is worth stating: **every rate
check divides by `durationMin` and is skipped when it is absent or zero.** A payload carrying one
field and nothing else meets no check at all.

So the two layers are complementary rather than redundant — single-field ceilings close precisely the
hole the rate checks leave open.

## Bounds derived, not invented

The ceilings are computed from the rate constants that already exist, so a single-field bound can
never contradict the per-minute check sitting beside it:

```
MAX_ACTIVITY_DURATION_MIN  = 1440                                    // a day
MAX_ACTIVITY_DISTANCE_KM   = MAX_AVG_SPEED_KMH   × 24 h  = 2,880 km
MAX_ACTIVITY_KCAL          = MAX_KCAL_PER_MIN    × 1440  = 144,000
MAX_ACTIVITY_STEPS         = MAX_STEPS_PER_MIN   × 1440  = 316,800
```

`MAX_ACTIVITY_DURATION_MIN` has a structural justification rather than a round-number one:
`addMinutes` wraps at `% 1440`, so beyond a day the value cannot be represented at all.

The nested schemas were bounded too — `paceSeries` allows 2,000 points and `elevationProfile` 2,000,
each previously of unbounded numbers, which is the same hole with more rows. `eleM` is signed
(`±MAX_ACTIVITY_ELEVATION_M`) because an elevation *profile* carries altitude, and the Dead Sea shore
is −430 m.

## Two of the entry's claims were wrong

1. **The HR fields were already bounded.** `activityImplausibleReason` rejects `avgHr: 9999` today
   (20–250 bpm). They were never part of the gap; the entry listed them anyway.
2. **`deriveEndTime` does not push an activity into the wrong day.** The entry said an over-long
   duration "produces an end timestamp days later". `addMinutes('08:00', 100000)` returns
   **`18:40`** — the same day, because of the `% 1440` wrap. Pinned in a test so the reasoning is not
   re-derived from the entry's version.

## The limitation I did not paper over

The entry argued the dangerous case is a typo like 1000 for 100, since nothing looks wrong
afterwards. **A physiological bound cannot catch that** — 1000 minutes is 16.7 hours, which a real
ultra reaches, so rejecting it would reject a good day.

That case is pinned as a **passing** test asserting it is accepted, with the reasoning in the test
body. Catching typos needs a confirmation prompt on unusually long entries, not a tighter ceiling,
and leaving it silently unhandled would let a future reader assume it was covered.

## Verification

- 8 new tests: the reported reproduction, each field alone, the nested arrays, boundary values either
  side of every ceiling, a real activity and a 24 h ultra both still accepted.
- **Closed the way it was opened — POSTed against the running route**, since that is how it was
  proven:

  | request | before | after |
  |---|---|---|
  | `durationMin: 100000` | 201 | **400** |
  | `distanceKm: 99999` | 201 | **400** |
  | `caloriesBurned: 900000` | 201 | **400** |
  | `steps: 99999999` | 201 | **400** |
  | a real 90-minute walk | 201 | **201** |

  (Probe row deleted; the local DB is clean.)
- `check-numeric-bounds.js`'s `GRANDFATHERED_FILES` is now **empty** — the check refuses to let a
  file leave the list while still containing an unbounded number, so deleting the row required
  bounding all 28 first.
- `tsc --noEmit` clean · full suite **426 files / 3399 tests** green · all custom-rule scripts pass.

## Not exercised

The APK. `pushMutations` parses with this same schema, so the offline write path is covered by
construction — but an outbox payload that now fails validation takes the poison-pill quarantine path
rather than writing, and that behaviour was not exercised on device.
