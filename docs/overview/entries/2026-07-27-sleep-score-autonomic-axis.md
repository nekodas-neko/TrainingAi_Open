## 2026-07-27 — Sleep Score gains an autonomic axis (v1.215.0)

Owner-directed follow-up to the data-quality review's case study of the night of 2026-07-25
([`docs/reviews/2026-07-27-night-2026-07-25-case-study.md`](../../reviews/2026-07-27-night-2026-07-25-case-study.md)).
That night was rated **5/5 "Terrible"** in the morning check-in and scored **80**. It was normal on
every contributor the model had — 7.00 h, 94% efficiency, 1.00 h deep, 10 min latency — and abnormal
only where nothing was looking: HRV 34.0 ms (−2.76 σ, the lowest of the whole BLE era), average
overnight HR 72 against a 62 norm, and a 05:19 wake about two hours early.

### One correction first

The case study originally claimed the `hrv` contributor "was not supplied". That was wrong, and
reproducing the route's exact 28-day window proved it: `app/api/readiness-score/route.ts` **does**
pass `hrvBaselineMs`, the contributor fired, and it scored 57/100. The document now carries the
correction inline. The real defects turned out to be narrower and more interesting — four of the six
callers passed *no* baseline (so the same night scored 82 on the weekly digest and 80 on the Health
screen), and the baseline the one caller did pass reached back far enough to include 10 Cloud-era
nights on the pre-re-key HRV scale (**Q-4**), dragging it 6 ms low and flattering the ratio.

### What shipped

1. **One shared baseline derivation** — `sleepScoreBaselines(priorSessions, tz)` in
   `lib/health/sleep-score.ts`, used by all six callers (`readiness-score`, `body-battery`,
   `weekly-digest`, `sleep-trend`, the resilience rollup, the score audit). Filters to main sleeps
   (`MAIN_SLEEP_MIN_HOURS = 4`) so naps — whose HRV/HR are measured awake — stay out of a *sleep*
   baseline. `computeSleepScoreSeries()` scores a history with each night judged against its own
   priors. `body-battery`'s sleep window widened 2 d → 28 d so its fallback anchor can use the same
   baselines.
2. **`hr` contributor (weight 14)** — overnight average HR vs personal baseline, mirroring `hrv`.
3. **`schedule` contributor (weight 8)** — bed/wake vs habitual, **directional**: only a late bedtime
   or an early wake is penalised, worst endpoint wins. The symmetric version marked 2026-07-27 down
   94 → 89 for an early night *after* a bad one, which is the opposite of the intended signal.
4. **Rebalanced weights** — autonomic state is now 28 of 110 (25%) rather than 12 of 100 (12%);
   `totalSleep` stays the largest single term at 24.

### Effect on real history

Swept over every BLE-era night in production. The 2026-07-25 night goes **82 → 71**, moving from 5th
lowest of 20 (indistinguishable from ordinary nights at 81 and 85) to **2nd lowest, 5 points clear of
the 3rd** — only a 5.33 h night scores below it. Gap to the median night widens from 6.5 to 18.5
points. The new contributors are worth ~9 of that and the reweight ~3, which is the evidence-backed
answer to the owner's "does the reweight make much difference" question. The top of the range is
untouched: best night still 98, the four best all move by ≤1, and a perfect night still reaches 100
(pinned by a regression test — the owner's explicit constraint).

**Historical scores change meaning.** Any night with a mature baseline now scores differently than
when it was persisted to `oura_daily_derived`. That was the point, and it was authorised, but it is a
semantic change to stored history.

**This also unblocks Q-1.** The backlog carried a hard sequencing constraint: fixing the nap/artefact
row selection in isolation would move 2026-07-26's readiness 29 → 46 and clear its illness flag,
scoring the owner's worst night *better* than before. With the recalibration landed first, that night
now scores on its own merits and Q-1 is safe to take.

### Verification

Full suite 2,086 passing (7 new), lint and typecheck clean. Dev-server run against a local Postgres
seeded with 14 nights plus a reconstruction of the 2026-07-25 night: `/api/readiness-score` returned
all ten contributors and scored it **71**, matching the production sweep exactly;
`/api/body-battery`'s anchor agreed at **71** where it would previously have said 82;
`/api/weekly-digest` 200; `/api/admin/day-review` rendered all ten contributors with effective
weights summing to 1.0. The stock local seed carries no HRV or HR at all, so it was backfilled first
— without that the new contributors never activate and the run only proves the fallback path.

**Not exercised — on-device.** The sleep-detail contributor chart gains two bars and has not been
seen on the S25; native SQLite, the APK WebView and the real BLE path leave no trace in a dev-server
run. Device smoke still owns that half.

Remainders queued: **Q-16** (`sleep_quality_feel` as a historical calibration record — the owner's
decision is that it stays out of the score), **Q-17** (Body Battery consumed 0 of 235 available ring
readings on a strap-less day), **Q-18** (the Q-1 artefact is written into `body_metrics` too, moving
every HR-zone boundary — must ride with Q-1).
