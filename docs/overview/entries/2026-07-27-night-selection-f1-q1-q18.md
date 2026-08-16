## 2026-07-27 — Naps no longer overwrite nights: F-1 / Q-1 / Q-18 (v1.216.0)

Closes the bug that started this whole line of work — *"my sleep score doesn't match how I slept"*.
Owner-directed; the design decision (circadian window) and the fragmented-night requirement both came
from them.

### The defect

Four separate places answered "which sleep session is the night?" and all four answered it the same
wrong way — sort by `sleepEnd` descending, take the first. On any day with a nap after waking, the
nap won. A 20-minute nap produced a **Sleep Score of 5** against a 7.86 h night at 90% efficiency
(F-1); the rollup's copy of the same mistake fed the nap into the **checkpointed EMA baselines**,
which is why it was worth its own finding (Q-1); and the `body_metrics` backfill iterated every raw
window last-wins, so a 45-minute doze wrote `resting_heart_rate = 73 / hrv_ms = 25` over a night's
real 60 / 34 — and that column is the input to `resolveHrProfile`'s 28-day mean, so it moved every
HR-zone boundary (Q-18).

### Why the obvious fix would not have worked

The intuitive rule is "merge sleep windows closer together than N minutes". Measured against the real
history, that provably cannot work:

```
05-29 00:38 → 02:23   105 min   a GENUINE fragmented night (2.53 h + 4.02 h, one sleep)
06-29 21:14 → 22:21    67 min   an evening NAP followed by the night
07-01 20:19 → 21:40    81 min   ditto
06-27 20:53 → 22:26    94 min   ditto
```

The real fragmented night has a **larger** gap than three nap→night transitions, so no threshold
separates them. What does separate them is *when* the sleep sat: every real night in the history has
a midpoint between 01:00 and 04:30; every nap's midpoint falls outside 21:00–10:00 (closest are an
evening nap at 20:53 and a late-morning one at 10:14).

### What shipped

New shared module `lib/health/sleep-night.ts` — one place, four consumers:

- **Classify by circadian position first.** Midpoint inside `[21:00, 10:00)` = night sleep, else nap —
  **unless** the sleep runs ≥ 4 h, in which case it is night sleep wherever it sat on the clock. That
  escape hatch costs nothing here (longest nap in the history is 1.42 h, shortest real night 5.33 h)
  and stops the rule failing catastrophically for anyone whose sleep isn't nocturnal — shift work,
  jet lag, a long daytime recovery sleep. Without it such a sleeper would score nothing at all.
- **Then merge fragments** up to `MAX_INTRA_NIGHT_GAP_HOURS = 3` apart. Because merging only ever
  applies between two windows already inside the band, a nap can never slip in — which is what makes
  a generous 3 h threshold safe.
- **`aggregateNight()`** collapses a fragmented night into one scoreable session: sleep hours and
  stages sum, time-in-bed spans the whole period *including* the wake-up gap so efficiency correctly
  drops, each gap counts as an awakening, autonomic readings are duration-weighted, and
  `lowestHeartRate` takes the true minimum. A single-window night is returned unchanged apart from
  restamping its wake day (production has rows whose stored `date` disagrees with their wake time).

Wired into `app/api/readiness-score/route.ts`, `lib/health/score-audit/sleep.ts`, and the rollup in
`lib/data/postgres/adapter.ts` (which now resolves per-window candidates into one row per night after
the loop rather than last-write-wins). Q-18 fixed in the same pass — the `body_metrics` HRV/RHR
backfill now reads the resolved nights.

### Verification

2,111 tests passing (15 new), typecheck and lint clean. The new tests are built from the actual
production windows, including the case that kills naive gap-merging (a 67-minute nap→night gap must
*not* merge while a 105-minute intra-night gap must).

Replayed against every production day that carries more than one session:

| day | OLD (latest `sleepEnd` wins) | NEW |
|---|---|---|
| 2026-07-07 | 0.33 h, rhr 68 | **7.86 h, hrv 37, rhr 57** |
| 2026-07-10 | 1.42 h, hrv 54, rhr 67 | **8.83 h, hrv 40, rhr 58** |
| 2026-07-16 | 0.25 h, hrv 56, rhr 70 | **7.33 h, hrv 43.5, rhr 57** |
| 2026-07-21 | 1.33 h, rhr 75 | **7.75 h, hrv 61, rhr 52** |
| 2026-07-26 | 0.00 h, hrv 25, rhr 73 | **7.00 h, hrv 34, rhr 60** |

Dev-server run against a local Postgres seeded with a post-waking 0.00 h nap and a night split by a
105-minute wake-up: `/api/readiness-score` scored the **night** (71, all ten contributors) rather than
the nap, and `/api/admin/day-review` showed the fragmented night reassembled — totalSleep input
**6.55 h** (2.53 + 4.02), efficiency recomputed to **78** across the gap (vs the 93/95 stored on the
halves), restfulness input **4** (1 + 2 restless + 1 gap awakening), HRV duration-weighted to 0.923×.

**A note for the next session:** the first CI run failed two DB-backed rollup tests that had passed
locally, because the session hook unsets `DATABASE_URL` and vitest then *skips* 49 tests. Run
`DATABASE_URL=… npx vitest run` against the local Postgres to get the CI-equivalent suite (2,299 tests
rather than 2,250). Those two failures were worth having — their fixture's synthetic "night" runs
11:00→19:00 local, which is what surfaced the shift-worker gap above. The fixture was left alone; the
rule was fixed.

**Not exercised — on-device.** No native path is touched, but the sleep detail screen's rendering of a
reassembled night has not been seen on the S25.

### Consequences worth knowing

- **Persisted history is not retroactively corrected.** `oura_daily_derived` rows still hold
  nap-derived scores for the affected days; **F-2's backfill** is what fixes those, and it is now
  unblocked (its entry previously waited on this).
- **Q-10 downgraded.** It was filed as a prerequisite on the assumption the fix would have to guess
  nap-vs-night from duration. It doesn't — circadian classification separates every case in the
  history without a stored session type.
- `lib/sleep/merge-sessions.ts` still carries its own 1-hour clustering for the Health-Connect-era
  read path at `/api/sleep-sessions`. Left alone deliberately: it handles Samsung midnight-splits I
  can't reproduce or verify here, and an unverifiable change to it would be worse than a documented
  seam. Worth reconciling once there is a device to test against.
