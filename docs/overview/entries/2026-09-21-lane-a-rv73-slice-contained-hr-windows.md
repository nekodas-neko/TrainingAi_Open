# RV-73 — the two extra pulls were for rows already in memory

**Branch:** `lane-a/rv73-slice-contained-hr-windows` · **Lane A** · no migration, no native change.

`/api/cardio-week` called `resolveHrProfile` — which pulls 90 days of heart rate, the heaviest query
in the app — and then, in the same `Promise.all`, issued **two more** `getHrForWindow` calls for a
rolling 30-day window and the 30 days before it. Both of those windows sit **wholly inside** the 90
days already fetched. The route now slices the rows it was handed. **Three passes become one.**

## The entry's own unknown, answered

RV-73 said: *"how `hrRows`/`priorHrRows` are consumed further down the route was not read, so whether
an aggregate suffices is unverified — **establish that before assuming the aggregate fits**."*

Read: they are consumed at exactly two places, and nowhere else in the route's 145 lines —

```ts
const observed      = computeObservedHr(hrRows.map((r) => r.bpm))
const observedPrior = computeObservedHr(priorHrRows.map((r) => r.bpm))
```

Everything below line 100 reads `observed`/`observedPrior`, never the rows. So a reduced shape fits.

Also worth correcting: the entry hedged that *"prod data spans 88 days so the prior window is almost
entirely inside it too"*. That reasons from **data span**, which is the wrong quantity. The prior
window is `[t−60, t−30]` and the pull is `[t−90, now]` — containment is exact and a property of the
constants, not of how much data happens to exist.

## Why the rows come back from a separate export

`resolveHrProfileWithWindow` returns `{ profile, hrRows, from, to }`; `resolveHrProfile` delegates to
it and drops the rows, so its ten-plus call sites are untouched.

**The rows are deliberately not added to `HrProfile`.** `/api/hr-profile` serialises that interface
straight into its response body, so a 130,000-row array on it would ship the entire window to the
device.

## The one caveat, measured rather than argued

`getHrForWindow` applies `preferStrapBuckets`, which drops a ring row when a chest-strap row shares
its 10-second bucket. Merging over 90 days and *then* cutting is not identical to merging a fresh
30-day query: the wider merge can drop a ring row whose bucket-mate sits just outside the caller's
window. The difference is bounded to the rows in the single bucket straddling each boundary, and it
is always in the direction of dropping a ring reading the strap already covered — the slice is a
subset, never a superset.

Measured against production over the owner's current 30-day window, both paths give **57,998 rows,
mean 86, k-th highest 175, k-th lowest 37** — identical.

## The test that had to change, and why that is the proof

`lib/__tests__/cardio-hub-routes.test.ts` answered `getHrForWindow` *by which window was asked for*,
returning bare `{ bpm }` objects with no timestamps — a fixture shape that only works while the
repository does the splitting. Three tests broke immediately on `r.timestamp.getTime()`.

That break is the finding, not an obstacle to it: the split moved from the query to the timestamps,
so the fixture now places each reading in time (15 days back for the current window, 45 for the
prior — both well clear of a boundary). Four new tests pin what the slice has to preserve.

## Sibling sweep

The entry flagged `cardio-trends` and `zone-minutes` as unchecked for the same duplication. **Neither
calls `getHrForWindow`** — both call `getZoneMinutesRange(userId, from, to, tz, profile)`, so the
duplication is unique to `cardio-week`. And `getZoneMinutesRange` is not a hidden N+1 either: it is
backed by the `daily_zone_minutes` cache, serves past days from it when the profile matches, and
resolves the cold path with `Promise.all` — a comment records that the serial version was already
fixed (C-5). Nothing new to file.

## Verification

- **4 new tests**: one `getHrForWindow` call rather than three *and* that the one call is the 90-day
  window; distinct per-window values so a wrong slice shows as a wrong delta rather than a plausible
  number; a reading landing exactly on the shared boundary counting in **both** windows (pinning
  `gte`/`lte` behaviour, not endorsing it); and a reading inside the 90 days but outside both
  reported windows being excluded rather than folded in.
- **Mutation pass — three mutations, one control.** Exclusive lower bound → 1 failed; prior window
  taking everything before `observedFrom` → 1 failed; no slicing at all → 4 failed. The deliberately
  equivalent control (hoisting the two `getTime()` calls out of the predicate) → **27 passed**.
- The 23 pre-existing tests in that file pass unchanged once the fixture carries timestamps.
- Full suite, `check:rules` and `check-test-typecheck` below.

## Not exercised

- **No device check and no route run.** Auth precedes validation, so a dev-server curl reaches 401
  rather than the handler; coverage is the handler-importing route tests above.
- **Production was read, not written**, and `claude_ro` is row-scoped to the owner, so the
  57,998-row equivalence is the owner's window rather than a claim about every account.
- **The saving is not timed end-to-end.** Two `getHrForWindow` calls stop being issued; what that is
  worth on the wire was not measured, because the route cannot be authenticated against in
  production — the same gap RV-64 and the entry both record.

## One thing noticed and deliberately not changed

`app/api/cardio-week/route.ts` defines a local `const OBSERVED_WINDOW_DAYS = 30` while
`packages/shared/src/health/hr-profile.ts` — which this route imports from — exports
`OBSERVED_WINDOW_DAYS = 90`. Same name, different value, one file apart. Not a bug (the local one
shadows nothing, since the route never imported the other), and renaming it is a readability change
outside this diff's remit. Recorded so the next reader is not caught by it.
