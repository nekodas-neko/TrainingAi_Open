## 2026-07-27 — Data-quality review #2: derived metrics, EMA baselines, stored counters (docs-only)

Second standing data-quality session per [`docs/data-quality-review-charter.md`](../../data-quality-review-charter.md),
using the read-only production endpoint. **Report-only — no code changed.** Findings:
[`docs/reviews/2026-07-27-prod-data-audit-2-derived-metrics.md`](../../reviews/2026-07-27-prod-data-audit-2-derived-metrics.md).

**Fifteen findings (Q-1 … Q-15), all queued in `docs/implementation-backlog.md`, with
`projectOverview.md` Known-Issues rows for the eight that affect shipped behaviour.** The two
headline ones are both the charter's archetype — *correct arithmetic, wrong input selection*:

- **Q-1 (HIGH):** the nightly rollup keys `nightInputsByDate` on wake-day with **last-window-wins**
  (`adapter.ts:4815`), so an evening nap overwrites the night. 4 of 21 `oura_daily_summary` rows hold
  a nap's numbers; the persisted readiness on those days is **48 / 37 / 29 — the three lowest values
  in the entire 12-value history** — and **2026-07-26 raised an illness "watch" and dropped readiness
  to 29 off a 45-minute, zero-sleep row** while a 7.00 h / 94 % night sat unused. Worse than F-1
  because these rows feed the *checkpointed* EMA baselines, so a fix needs a full-history replay.
- **Q-2 (HIGH):** `temp_event` frames decode to **three interleaved temperature channels**
  (`1b0dac0df70d → [33.55, 35.00, 35.75]`); the rollup flattens them into one series, so the median-7
  nightly-temperature filter lands on the coarse middle channel. `temp_mean_c` is a whole degree on
  17 of 20 nights and swings 34 → 37 °C; the baseline spread converges to 2.63 °C, leaving `tempZ`
  and the `bodyTemperature` readiness contributor with no discriminative power.

Also found: four sleep columns changed **scale** at the BLE re-key with no conversion
(`restless_periods` 230.6 → 2.5, `respiratory_rate` 13.11 → 9.32 rpm, `average_hrv_ms` 27.5 → 49.0,
`lowest_heart_rate` 65.1 → 56.7 — the first three with **non-overlapping ranges**); `personal_records`
is not the all-time best (Bench 90.8 stored vs a real 96.0) because the seed route overwrites it
unconditionally; the six EMA baselines seed at zero and produced a **+17.0 °C** temperature deviation
that went straight into the AI prompt; the **Activity Score has zero persisted history** since the
re-key; and `user_stats` counts 26 % of lifetime volume from workouts that were never completed.

**Periodization / prescriptions** were then audited in full at the owner's prompt, and are clean apart
from a third instance of the same "same column, two scales" class:

- **Q-12 (HIGH):** bodyweight 1RM has two incommensurable eras. `estimateOneRm` prices a bodyweight
  set at a fixed `BW_REF = 100 kg`; before ~2026-07-05 it used the real weigh-in. Every July
  `estimated_1rm` reproduces exactly at `bwRef=100`, no June row does — so **Pull-Up reads 82.0 kg on
  2026-06-28 and 114.5 kg on 2026-07-05, +39.6 % on equal-or-fewer reps**, recorded as a real PR at
  the changeover minute and feeding the prescription engine's 1RM-trend signal.
- **Q-13 (MED):** the same sets are worth `BW_REF + added` for 1RM/intensity and the **raw** weight
  for volume, three lines apart in `log-exercise.ts` — 32 sets / 208 reps of Pull-Ups and Hanging Leg
  Raises carry `volume = 0` and vanish from ACWR, `user_stats`, and the engine's own volume budget.
- **Q-14 (LOW–MED):** `planned_pct` vs `intensity_pct` on different bases for bodyweight → a
  structural 13–19 pp "overshoot" on every such set.

Everything else on that surface checked out and is recorded as clean so it isn't re-audited:
`sessions_in_phase` reconciles exactly on all 10 rows, `intensity_pct` reconciles against the
PR-derived reference on 21 of 23 exercises (the 2 exceptions independently corroborate Q-5),
`baseline_1rm` snapshots match the PRs as of their generation date, prescription `confidence` is
deterministic rather than LLM-reported, and `pending` status still drives load by design. Two traps
were logged in the charter: `ws.program_session_id` is a dead column (NULL on all 75 rows — joining
`sessions_in_phase` on it makes every row look drifted), and `ws.session_id`'s 46 NULLs are all
May/June with none since.

**Verification / method.** Every number is from production via `POST /api/admin/db-query` (~24
batched queries). **No formula was reimplemented in SQL** — where scoring evidence was needed, the
real modules (`computeSleepScore`, `decodeEventBody`, `estimateOneRm`) were run against production
rows in a throwaway vitest file, which is how Q-2's channel structure, Q-3's ~31-point restfulness
swing and Q-12's `BW_REF` changeover were established.

**What was NOT exercised.** Admin → Day Review was **unreachable** (401 — its bearer path needs
`ADMIN_EXPORT_SECRET`, which this session did not have; noted in the charter so a future session asks
for it). More importantly, **this covers Postgres only**: native SQLite, the mutation outbox, BLE
drain/connection behaviour, safe-area insets, gestures and Samsung WebView rendering leave no trace
in the database. Q-11 in particular (79 % of `set_hr_stats` rows have `coverage_ok = false`) is a
*measurement*, not a diagnosis — its root cause is almost certainly on-device.
`docs/device-smoke-checklist.md` remains the authority for that half.


**Owner-directed case study — the night of 2026-07-25 → 26** (report: *"very bad sleep; felt really
bad/tired all of the 26th"*). Written up as
[`docs/reviews/2026-07-27-night-2026-07-25-case-study.md`](../../reviews/2026-07-27-night-2026-07-25-case-study.md),
queued as backlog **Q-15**. The night was genuinely bad on the autonomic axis — HRV 34.0 ms
(−2.76 σ, the lowest of the whole BLE era), average overnight HR 72 vs 62 on each of the three
preceding nights, a 05:19 wake ~2 h early, bedtime hour averaging 85.7 bpm — and completely normal on
duration (7.00 h), efficiency (94), deep (1.00 h), latency and restlessness, which are the only things
the Sleep Score reads. It scored **82**. The `hrv` contributor is opt-in and the caller never supplies
the baseline (supplying it → 77), and there is no heart-rate contributor at all, so autonomic state is
≤12 % of the score. The owner's own `sleep_quality_feel = 5` ("Terrible") feeds nothing quantitative.

The sharp consequence, and the reason this rides with Q-1 rather than after it: readiness that day
shipped at **29**, but only because `oura_daily_summary` held the Q-1 artefact row. Re-running the
real composite on the real night gives **46**, with the illness flag dropping `watch` → `normal`. So
**fixing Q-1 in isolation would make the app score the owner's worst night of the month better than it
does today.** Also surfaced: Body Battery sat flat at 29 all day (charged 0, drained 0,
`hr_sample_count = 0`) while 235 ring HR readings across 23 hours existed for that date — the only
ring-only day in the window; and the artefact wrote `resting_heart_rate = 73 / hrv_ms = 25.0` into
`body_metrics`, which is a Q-1 propagation path into every HR-zone boundary via `resolveHrProfile`.

No version bump — docs-only, nothing user-visible changed.
