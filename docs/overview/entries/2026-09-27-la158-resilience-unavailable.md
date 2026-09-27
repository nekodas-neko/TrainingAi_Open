# LA-158 — the resilience tile was not blank, it was five days stale

**Branch:** `lane-a/la158-resilience-unavailable` · **Lane A** (engine half of LA-158).

## What the entry said, and what was actually true

LA-158 — which I filed earlier the same day while verifying TN-70 — said resilience had stopped
publishing and the surface had gone blank with nothing said. The first half is right:
`oura_daily_derived.resilience_level` has been NULL every day since **2026-09-22** while the
rollup runs normally.

The second half was wrong, and checking it before building changed what to build.
`buildReadinessPayload` reads a **7-day** window and takes the most recent row carrying a level:

```ts
repo.getOuraDailyDerived(userId, from7dIso, todayIso)
const latestResilience = [...derivedTodayRows].reverse().find(r => r.resilienceLevel != null)
```

So on 2026-09-27 the tile was **rendering 09-22's level 1 as though it were today's, with no date
shown** — `ResilienceTile` takes level, band and confidence and nothing else. It would have gone
blank a few days later, when 09-22 fell out of the window. **Two defects, and the live one was
staleness, not absence** — which is the worse of the two, because a stale number reads as current
while a missing one at least reads as missing.

## What shipped

`ReadinessScoreResponse` gains two fields:

- **`ownResilienceAsOf`** — the day the level came from, so a surface can tell today's number from
  last Tuesday's.
- **`ownResilienceUnavailable`** — `{ daysSeen, daysMeetingCoverageGate, coverageGateMinutes,
  minValidDays, modelWindowDays }` when no level could be shown.

Behind it, a new pure `observeResilienceCoverage` in `lib/health/stress-resilience.ts`, beside the
constants it reads (One Formula, One Place — the 240-minute gate and the 5-of-14 window are model
constants, not numbers to restate at a call site). Its companion `resilienceGateThresholds()`
returns null rather than throwing, unlike `C_()`: the constants are injected on the rollup path,
not on every request, and a readiness payload that cannot name the gate must still render.

## The one design decision worth recording

**It reports an observation, never a diagnosis.** The payload sees 7 days; the model gates on 14.
A shortfall the payload can see is therefore *consistent with* the coverage gate having closed
without establishing it — days 8–14 are not in view. So the fields make a true sentence — *"2 of
the last 7 days had enough daytime coverage; the model needs 5 of 14"* — and stop there. There is
deliberately **no `reason` string**, and a test asserts the exact key set so that a later
tidy-up cannot quietly promote it to a verdict.

Nulls mean "the constants were not injected on this request", which is a different thing from a
threshold of zero — a zero fallback would make every day "meet" the gate and read as healthy.

## Verification

- `tsc` clean. New test `la158-resilience-coverage-observation.test.ts` — **7 passed**, driven by
  the real production coverage series (290, 290, 170, 170, 120, 50, 150, 60, 150, 60, 140, 110, 50).
- **Mutation pass, 4 killed / 1 equivalent control as predicted:** `>=`→`>` killed (an explicit
  at-threshold case, since no production day sits exactly on 240 and the real series alone would
  not catch it); `daysSeen` dropping nulls killed; `minValidDays` reading `windowDays` killed; a
  `?? 0` fallback for the missing gate killed. The **control** — removing the `!= null` guard —
  survived, which is correct: `null >= n` is already false. The guard is kept and now says in a
  comment that it is defensive rather than load-bearing.
- Custom Rules **80 of 80**; readiness suite **117 passed / 16 skipped**.

**No version bump or changelog entry**: nothing user-visible changed. The payload carries new
fields and no surface reads them yet.

## Deliberately not done

- **The render is Lane B's** and LA-158 stays in the queue re-laned to B, naming exactly what to
  show. One Lane B file was touched — a one-line completion of an offline fallback object that
  must stay a full `ReadinessScoreResponse` for the build to pass. No rendering changed.
- **Why the coverage collapsed is not answered, and is now LA-160 (`Lane: DV`).** Either the ring
  is worn less in the daytime since mid-September or daytime-stress ingest has degraded, and the
  database cannot separate them — `worn_hours_ble` is NULL on every row, so there is no stored
  wear figure. Only the phone can tell.
- **The gate was not lowered.** Four hours is the vendor model's own constant; a level computed
  from 50 minutes would be worse than no level.

**Not exercised:** no device run — this is a JSON payload change with no native, safe-area or
offline-sync surface. Production was read, never written.
