## 2026-07-27 — Body Battery: an evening nap was throwing away the whole day (v1.221.0, audit finding Q-17)

### The finding was filed with the wrong cause

Q-17 was written as *"Body Battery consumes nothing on a **ring-only** day"* — the observation being
that 2026-07-26 was the only day in the window whose HR came from the ring alone, and the only day
that consumed nothing. The correlation was real; the causation was not. Nothing in the route filters
on `source`.

The actual cause is the **F-1 nap-vs-night bug, in a fifth place**:

```ts
const todaySleep = [...sleepSessions].sort((a, b) => b.sleepEnd - a.sleepEnd)[0]
const wakeTime   = todaySleep?.sleepEnd?.getTime() ?? …
```

Sort-by-`sleepEnd`-descending, take the first. On 2026-07-26 production holds **two** sleep rows: the
night 22:29 → **05:54**, and a 45-minute evening nap 17:24 → **18:09**. The nap wins, so `wakeTime`
became 18:09 — and the walk is `hrRows.filter(r => r.timestamp >= wakeTime)`, so the entire day's
heart rate fell *before* the anchor and was discarded.

The numbers confirm it exactly:

| window | ring samples available |
|---|---|
| after the real wake (05:54) | **164** |
| after the nap's end (18:09) | 37 |
| after the nap, before the 19:39 re-run | **0** |

That last figure is precisely the `hr_sample_count = 0` stored on the row. The battery sat flat at 29
from midnight to midnight — rendering yesterday's readiness anchor as though it were a measurement.

It was ring-only days that showed it because a strap day logs ~1,500 samples during a workout, which
on those days happened to fall after the nap. The nap is the cause; ring-only was the tell.

### What shipped

1. **The wake anchor is now the night that ended today** — `nightSessions(...)` then
   `findLast(n => n.date === todayIso)`, the same selection the readiness route, the day audit and
   the rollup use. Naps are excluded; a fragmented night reassembles. This also scopes the lookup to
   *today*: the old code took the latest session anywhere in a 28-day window.
2. **A future wake time falls back to the day's first reading.** If the recorded wake is later than
   "now", anchoring on it leaves zero samples and draws a flat line that reads as a measurement
   rather than as missing data. (This is what produced the `computed_at 05:16` half of the
   production row: at 05:16 the night's recorded end of 05:54 was still in the future.)
3. **The `ownSleepScore` early-morning fallback anchor** used the same `todaySleep`, so it could have
   scored the nap. Fixed by the same change; its baseline now comes from resolved nights too.
4. **The response's `wakeTime` field re-derived the raw value** instead of returning the one the
   curve was walked from, so the number the client was told could disagree with where the series
   actually starts. It now returns the anchor that was used.

### Verification

Full CI-equivalent suite green, typecheck, lint and both custom-rule checks clean. Three new
DB-backed tests: the day's HR is consumed with an evening nap present, the curve is **bit-identical
with and without** the nap, and a future-stamped wake falls back to the first reading.

**Not exercised — on-device.** Server-side only, no native path, but the Body Battery card has not
been re-checked on the S25. The backlog entry flagged this as possibly device-side; it is not — the
defect is entirely in the route, and it reproduces from stored data alone.

### Worth knowing

This is the **fifth** site of the same sort-by-`sleepEnd`-take-first pattern (after the readiness
route, the score audit, the rollup, and — fixed earlier today — the sleep trend and weekly digest).
Every one of them has now been converted to `lib/health/sleep-night.ts`. A grep for the raw pattern
is the cheap way to catch the sixth.
