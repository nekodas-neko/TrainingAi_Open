# Activity — domain index

**Owns:** daily step counts and the whole step pipeline, the Activity Score, daily movement
totals and hourly movement, and activity auto-detection (the "activity detected" gate).

**Does not own:** a detected walk/run once it becomes a session — that is
[`cardio`](../cardio/README.md). The ring-side step *capture* is
[`devices`](../devices/README.md); this pillar owns what the counts mean once ingested.

## Code

| Area | Where |
|---|---|
| Detection | `lib/activity/auto-detection-service.ts`, `detection-thresholds.ts`, `motion-detection.ts`, `motion-gate.ts`, `blend-activity.ts` |
| Metrics | `packages/shared/src/health/activity-score.ts`, `hourly-movement.ts`, `zone-minutes.ts`, `daily-goals.ts`; `lib/health/step-estimate.ts`, `daily-summary.ts`, `daily-medians.ts` |
| Step capture (border with `devices`) | `lib/oura-ble/step-counter-pipeline.ts`, `step-orchestrator.ts`, `step-orchestrator-core.ts`, `step-day-buckets.ts`, `step-features.ts`, `gait-step-count.ts` |
| UI | `app/activity/`, `components/activity/` |
| Tables | `body_metrics` (steps), `oura_daily` (activity score, active calories, activity times) |

## Reference docs

- [`docs/reviews/2026-08-26-hr-tile-and-activity-pacing.md`](../../reviews/2026-08-26-hr-tile-and-activity-pacing.md) — **Activity as a pace-to-goal score, 2026-08-26 (TN-17).** The owner's design — start near 100 at wake, decay if you fall behind a prorated target — **works mechanically**: `body_metrics.steps` is a running daily total, so "steps so far" needs no new plumbing. **⛔ Do not reach for `step_live_windows`** — the obvious intraday source holds **8 rows across 6 days**, total 7,745 steps, and reads a flat zero. **The obstacle is goal calibration:** the owner's median day is **4,649 steps** and they reach 7,000 on **32%** of days, 10,000 on **15%** — so a paced score goes red from mid-morning on most days where the current lenient average reads 63–82. Pacing does not create that; it stops the averaging from hiding it. `Needs: Q-524`.
- [`docs/reviews/2026-08-26-pillar-review.md`](../../reviews/2026-08-26-pillar-review.md) — **the five Home pillars answered, 2026-08-26.** The Activity tile is **today's** score and therefore a partial day (63 at 07:03 against 78/82 the two completed days before) — readiness separately carries `prevDayActivity` for the completed day, so both windows exist in different places. **100 has never happened**: over 30 days mean 75.1, sd 7.5, range 51–91. It is **not reachable by behaviour** while `zoneMinutes` is floored at 0 on **53 of 59 days** (Q-523), `activeEnergy` is present on **8 of 51** (excluded and renormalised otherwise), and `moveHours` qualifies **99.8% of hours** (TN-11).
- [`docs/reviews/2026-08-18-cross-user-isolation.md`](../../reviews/2026-08-18-cross-user-isolation.md) — **cross-user isolation, driven with two real accounts, 2026-08-18** (**10 of 11 probes rejected by the route's own ownership check**, including logging a set into another user's session and completing their workout; **the enumeration control passed** — a nonexistent id and another user's id return byte-identical responses. Q-556 — `DELETE /api/activity-logs` returns `200 {"success":true}` for a row it did not delete; **verified not a leak**, the row is intact, but it is inconsistent with every sibling and a false 2xx confirms an outbox mutation away). **The first run reported eleven clean results and proved almost nothing** — six hit routes that do not exist, and an HTML 404 reads exactly like an access-control pass.
- [`docs/reviews/2026-08-18-known-issue-duplication.md`](../../reviews/2026-08-18-known-issue-duplication.md) — **a Known Issue in two lists at once, 2026-08-18** (Q-553 — **Q-139 read `🔴 OPEN` in `projectOverview.md` and `✅ fixed` in the resolved archive for ten days**, 69 lines describing a bug fixed 2026-08-08; **Q-81** was a byte-identical 31-line entry in both. Both were also **archived early** — the rule forbids moving while a device check is owed, and both name one. Fixed here, and now enforced by `scripts/check-known-issue-duplication.js`, step 41 of 41.)
- [`docs/reviews/2026-08-18-server-only-writes-to-local-first-domains.md`](../../reviews/2026-08-18-server-only-writes-to-local-first-domains.md) — **the activity delete audited end to end, 2026-08-18** (Q-488 — it updates the server and the caches but never the local store, so session-select, nutrition and the activity-history card keep showing the deleted activity until the next pull; self-heals via the tombstone). The Health Connect metrics PATCH is also server-only but its full pull chain checks out.
- [`docs/reviews/2026-08-15-comprehensive-app-review.md`](../../reviews/2026-08-15-comprehensive-app-review.md)
  — §1.2 measured the Activity Score in production after v2: sd 5.9 over 19 days, range 66–91, 10
  distinct values. **v2 fixed the mechanism Q-137 blamed and the outcome did not move** (Q-277),
  and the score exists on only 19 of 40 days (Q-278).
- [`docs/reviews/2026-08-19-daily-vs-weekly-windows.md`](../../reviews/2026-08-19-daily-vs-weekly-windows.md) — **daily goal vs weekly target, 2026-08-19 — reshapes Q-505.**
  `DEFAULT_ZONE_MINUTES_GOAL = 22` is **WHO's 150 min/week ÷ 7**, and that division loses the
  guideline: 150 minutes in three sessions satisfies WHO and fails the daily goal four days in seven.
  **Rule — match each contributor's window to its guideline's own unit**; applied across all six,
  exactly one is wrong. **Recommendation: split into a daily number** (`steps`, `moveHours`,
  session-happened) **and a weekly one** (active minutes vs WHO 150, strength frequency, tonnage).
  **This retires `strengthFreq`'s ceiling as a defect** — 100 on 78% of days is correct behaviour for
  a weekly compliance metric; its scorecard was the problem, not its ceiling.
- [`docs/reviews/2026-08-19-active-minutes-who-threshold.md`](../../reviews/2026-08-19-active-minutes-who-threshold.md) — **the active-minutes threshold, fitted 2026-08-19 — read before touching
  `activeMinutesFromZoneSeconds`** (Q-523 answered). Its comment claims the WHO convention and is
  **one band off it**: it treats Zone 2 (**≥60% reserve**) as *moderate*, but WHO/ACSM moderate is
  **40–59%** and 60% is where *vigorous* begins — so **moderate intensity maps to no zone at all and
  has been scoring zero by construction.** Fixing that, plus anchoring on `targetAnchorMax` (observed
  **167**) rather than `maxHr` (age-predicted **187**), takes the contributor from **0 on 53 of 59
  days** to sub-score **mean 63.8, sd 38.7** — **the highest-variance input in the Activity Score.**
  **Do not re-cut `ZONE_DEFS`** — training zones are not the defect; the roll-up that borrows them is.
- [`docs/reviews/2026-08-19-score-audit-trail.md`](../../reviews/2026-08-19-score-audit-trail.md) — **whether each score can be re-audited later, 2026-08-19** (Q-526 — **activity was
  the only score that stored the wrong thing**: `activity_contributors` held the blend wrapper
  `{base, adjustment, trained}`, not `computeActivityScore`'s six components, which were already in
  memory on the same request. Sleep stores 10 real sub-scores, readiness stores its contributors plus
  `provisional` flags and, since Q-501, each contributor's own input; illness stores all four
  biomarker z-scores on every scored row. **Fixed 2026-08-26** — the six components, `preTaper` and
  `acwr` are now stored, so a row reproduces its own score. **Forward only**: rows before that date
  hold the wrapper and cannot be recovered, so Q-505's before/after comparison window starts there.)
- [`docs/reviews/2026-08-19-activity-contributor-audit.md`](../../reviews/2026-08-19-activity-contributor-audit.md) — **every Activity Score contributor measured, 2026-08-19 — read before touching
  the model** (the audit Q-277 asked for and never got). Over 90 days: **steps** (sd **33.4**) and
  **strengthVolume** (sd 23.8) carry real information; **strengthFreq** sits at 100 on **78%** of days;
  `moveHours`, `zoneMinutes` and `activeEnergy` carry none (Q-521/522/523). After renormalisation
  **51% of effective weight is informative and 49% is not** — and `strengthFreq`'s ceiling is a
  **documented design choice, not a defect**, so the redesign has to find range elsewhere. Q-137/Q-190
  *did* work — stored sd **5.0 → 7.4** across 2026-08-11 — but history is not back-filled, so most
  stored days still show the old model. **Q-277 answered and removed; folded into Q-505.** Also filed
  **Q-524** — the Goals Progress card and the daily digest grade steps against **7,000** while the
  Activity Score and its own progress bar use **10,000**, and the derived 10,000 contradicts the
  Paluch 7–8k plateau that `daily-goals.ts` cites as its evidence base.
- [`docs/reviews/2026-08-19-zone-minutes-move-hours-coverage.md`](../../reviews/2026-08-19-zone-minutes-move-hours-coverage.md) — **the Activity Score's two heart-rate contributors, coverage-checked 2026-08-19**
  (Q-522 — `moveHours` is **saturated**: 856 of 857 waking hours with HR data count as "moved" and
  **48 of 59 days score exactly 100**, so its only source of variance is hours the ring was off. This
  is **Q-188 returning through the other half of the fraction** — that fix corrected the denominator,
  the numerator now saturates on its own. Q-523 — `zoneMinutes` is **floored**: **0 on 53 of 59 days**,
  because Zone 2 starts at 133 bpm and the chest strap's **p99 during workouts is 121**; the existing
  strength-day guard suppresses it on 40 of 44 strength days but leaves **13 of 15 non-strength days**
  scoring a hard 0. Plus a separable defect: the 120 s gap cap versus the ring's exact **300 s**
  cadence keeps 35% of ring time against the strap's 84%, so zone minutes are not comparable across
  days.) **Both are named inputs in Q-521's Body Battery brief — build that on steps + workout load first.**
- [`docs/activity-goal-calibration.md`](../../activity-goal-calibration.md) — **why the Activity
  Score barely moves** (30-day sd 5.9 while steps run sd 4,028), why re-anchoring the goals to the
  user's own baseline is the wrong instinct, what Garmin/Whoop/Strava/Apple do instead, and the
  evidence base (WHO 2020, Paluch 2022, MET-minutes) for any target we pick. **Read before changing
  the Activity model or its goals** (Q-137, 2026-08-11).
- [`docs/oura-ble-operations.md`](../../oura-ble-operations.md) — the step pipeline's failure-point
  matrix and the data-integrity runbook. **Read before touching step ingestion.**
- Plans: `ls docs/superpowers/plans/*step*` (5 today).
- [`docs/superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md`](../../superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md)
  — Workstream A: why every guided walk with a fractional segment mean HR dead-lettered in the
  outbox and never reached the server or the training calendar (backlog Q-36), plus the
  activity-payload hardening follow-ups (Q-41).

- Reviews: [`docs/reviews/2026-08-07-full-app-review.md`](../../reviews/2026-08-07-full-app-review.md) — **full-app deep review, 2026-08-07** (saving/caching/performance/logic across all 201 routes and 40 pages; 53 findings queued as Q-117…Q-138, plus root cause for Q-73 and mechanisms for Q-72/Q-107)

- [`docs/reviews/2026-08-17-failure-cells-running-the-app.md`](../../reviews/2026-08-17-failure-cells-running-the-app.md) — **the failure-cells lens, run against a live app, 2026-08-17** (Q-450 — `/activity` reached without a type silently discards a completed activity: Start and Finish work, Save is a no-op). Findings Q-450…Q-455; four areas recorded **clean**.

- [`docs/reviews/2026-08-18-write-surface-not-found.md`](../../reviews/2026-08-18-write-surface-not-found.md) — **nutrition/cardio/activity writes probed cross-user, and the whole write surface measured for the not-found answer, 2026-08-18** (Q-463 — activity-log writes probed cross-user and hold; the not-found answer across the write surface measured). Finding Q-463; **cross-user protection holds across all four write pillars**, and the idempotent `DELETE` pattern is recorded as clean rather than filed.

## Open issues

```bash
grep -n '^### .*\[activity\]' projectOverview.md   # 14 entries today
grep -n '\[activity\]' docs/implementation-backlog.md   # 3 queue items today (Q-522, Q-523, Q-524)
```

Live at the time of writing (2026-07-30, plus the 2026-08-07 entry below):

- ⚠️ **Editing and deleting logged training was unreachable for a fortnight** (LB-1, fixed 2026-08-23,
  v1.334.0). Q-110 moved the calendar day-tap to `/health/day` and left the four controls on a sheet
  nothing opens. They now live on the day screen, driven by `lib/hooks/use-day-entry-mutations.ts`,
  which `health-content.tsx` shares. **Not device-verified** —
  [`journal`](../../overview/entries/2026-08-23-day-screen-edit-delete.md).

- ⛔ **Q-488 — the activity delete never updates the local store, and the obvious fix is a no-op.**
  **⚠ Stale as written (2026-08-23): `deleteActivityLog` exists now and the delete path calls it.**
  See the caveat on the `projectOverview.md` row for why the row itself has not been struck.
  Re-scoped 2026-08-18 and handed to Lane A: `lib/local-store` had no `deleteActivityLog`, and
  `upsertActivityLog` omits `deleted_at` from both its INSERT list and its `ON CONFLICT DO UPDATE
  SET`, so stamping `deletedAt` on a read-merged record type-checks and changes nothing. The fix
  needs a local-store method first, then four lines in `app/health/health-content.tsx`. Evidence and
  the reverted dead end:
  [`the journal entry`](../../overview/entries/2026-08-18-local-first-write-rule-and-journal-sweep.md).
  The rule it broke is now in `CLAUDE.md`'s Offline-First section.

- ✅ **The activity detail sheet's HR chart, zone breakdown and HR-coloured route line had never
  rendered** for any activity (found + fixed 2026-08-09, v1.276.1) — a validation-gate mismatch on
  `/api/oura/hr-window`, not missing data. Both that sheet and the exercise review sheet now
  cache-seed the HR window. See
  [`the journal entry`](../../overview/history-2026-08-08.md).

- ✅ **A lifting day's zero zone-minutes was scored as a missed cardio target** (Q-183, fixed
  2026-08-11, v1.279.2). The Activity Score already excluded *absent* zone-minutes and renormalised,
  but scored a structural zero at full weight (10) — and lifting with rest between sets rarely holds
  the ~60% HRR that zone 1 starts at. `computeActivityScore` now takes `strengthSessionToday` and
  excludes the lane on an exact zero, leaving rest-day zeros scored. Worth knowing for any future
  work on this score: **40 of the owner's last 45 days had exactly zero zone minutes**, so the lane
  carries very little information either way. See
  [`the journal entry`](../../overview/history-2026-08-08.md).

- ⚠️ **Q-139 — ring-clock compression FIXED (v1.270.25, 2026-08-08), not verified on device.**
  `resolveDsToMs` now applies the fixed 100 ms/ds slope with one offset per epoch (p10 of anchor lag),
  monotonic in `ds`; the sibling gap is closed too — `mergeStepCounterWithLive` gates **model** windows
  through `isPlausibleStepWindow`, not just live ones. **The owner decision was made** — *fix forward,
  no backfill* — so the previous "needs one owner decision" here was stale. **Only the on-device check
  remains**, which shows after the next real history drain. Record:
  [`docs/overview/known-issues-resolved.md`](../../overview/known-issues-resolved.md); this no longer
  blocks Q-71, which now uses Q-139's robust per-epoch offset.

- 🟠 **Three days hold inflated step totals that cannot self-correct** — open; a backfill preview
  was computed and confirms three days are materially inflated.
- The ring's step *model* is device-verified accurate, but the **orchestrator is not**.
- The Activity Score is now persisted, but that path is not device-verified.
- 🔴 **A guided walk can be permanently stranded in the outbox** (found 2026-08-02, queued as
  Q-36): `segments[].avgHr` is a 1dp mean but the wire schema demanded an integer, so the whole
  `activity_logs` payload was rejected on both write paths. The activity still renders locally
  (local-first read) while being absent from the server — and therefore from the training
  calendar, which reads `activity_logs` from Postgres.

Resolved and worth knowing (the step pipeline has had many faults): step merge now decides on
source rank rather than raw magnitude; impossible live windows no longer inflate counts; the root
cause of one class was a posted step window coming from a *different stream* than the count.

## History

- **[`docs/overview/entries/2026-08-24-activity-log-delete-outbox.md`](../../overview/entries/2026-08-24-activity-log-delete-outbox.md)**
  — Q-328: deleting an activity was the one activity-log write with no outbox domain, so offline it
  simply failed while creating one already queued. The client writes a local tombstone and queues
  `{ deleted: true }` now. **`softDeleteActivityLogPending`, not `deleteActivityLog`** — a queued
  delete must stay `pending` until its push is confirmed, or a pull clobbers it; `'synced'` is what
  later lets `applyDelta` reap the tombstone, so both values are correct at different moments.
  **The offline path itself is not exercised here** (`getLocalStore` is null in the sandbox) —
  `Gate: device`. Unblocks Q-556's 404 half.
- **[`docs/overview/entries/2026-08-17-activity-untyped-entry.md`](../../overview/entries/2026-08-17-activity-untyped-entry.md)**
  — 🆕 Q-450: `/activity` with no `activityType` recorded a full activity and discarded it on Save.
  The typeless store is the **normal** between-activities state (`resetSession()` clears the type
  after every save), so the guard belongs at the destination, not on the call sites — `/activity`
  now renders `SelectActivityTypeScreen`. The picker grid is shared with the Log Activity sheet via
  `components/activity/activity-type-grid.tsx`; keep both on it so the type lists cannot drift.
  Guard: `e2e/activity-untyped-entry.spec.ts`. Left open as **Q-351** (Lane A): a sub-3-second
  activity rounds `durationMin` to 0 and `ActivityLogBody.durationMin` is `.positive()`, so the POST
  400s and the activity is lost behind a generic toast — the outbox parses the same schema.

- Cross-domain, but the Activity Score change lives here:
  [`docs/handoff-2026-08-11-platform-queue-drain-deload-coverage-coach-charts.md`](../../handoff-2026-08-11-platform-queue-drain-deload-coverage-coach-charts.md)
  (Q-183 — a lifting day's zero zone-minutes is no longer scored as a missed cardio target; carries
  the 45-day measurement that chose the trigger, and the finding that **40 of 45 days were exactly
  zero**, which bears on any re-anchoring of that goal).
- Handoffs: `ls docs/handoff-*-activity-*.md` — including
  [`docs/handoff-2026-08-07-activity-ring-clock-compression.md`](../../handoff-2026-08-07-activity-ring-clock-compression.md)
  (Q-139 — why the ring's step timeline is distorted, why the Samsung-Health gap is *not* the bug,
  and the measurement traps that make this expensive to re-derive) — plus
  [`docs/handoff-2026-08-02-cross-owner-bug-batch-investigation.md`](../../handoff-2026-08-02-cross-owner-bug-batch-investigation.md)
  (Q-36 — the guided walk that could never sync, and the calendar blind spot behind it), filed under `cross` because it spans five pillars and so is not matched by the glob above.
- Journal: `grep -rl 'step\|activity.score' docs/overview/entries/` — plus
  [`docs/overview/history-2026-08-07.md`](../../overview/history-2026-08-07.md)
  (Q-140 — removed the Log Activity sheet's redundant "Interval walk" shortcut; Guided Walk keeps
  its own separate entry point on the Cardio Hub screen).

## Gotchas specific to this domain


- **A zero is a real reading, and `omitNullFields` does not strip it.** `distanceKm: z.number()
  .positive()` rejected the WHOLE activity payload for a GPS activity that never moved (Q-41
  finding 3). Use `.nonnegative()` for anything a stationary activity can legitimately compute;
  reserve `.positive()` for fields where zero genuinely means "not measured".
- **HR on an activity row comes from two paths, and they disagree.** Production has HR on 15 of 30
  walks (via the Health Connect enrichment) but 0 of 2 treadmills (the one type the save screen was
  written for). Check both before concluding a field is or isn't populated.
- **Steps arrive from several sources** (ring, phone, Health Connect) and merging them by raw
  magnitude was wrong — source rank decides. Any new source must join that ranking explicitly.
- **A step count and its time window must come from the same stream.** Mixing them produced
  inflated days that then could not self-correct.
- **Time bases differ across streams** — backlog Q-23 covers the cross-stream time-base problem
  outside the step pipeline; assume it applies to any new sensor feed.
- **Outbox-pending rows merge onto the calendar payload at *read* time, never into it.**
  `lib/calendar/local-overlay.ts` (`mergeCalendarOverlay` + `readLocalCalendarOverlay`, pending rows
  only) is the one way a not-yet-synced workout or activity reaches a calendar surface — the
  training calendar and Home's week strip/streak both use it. Do **not** make the server-payload
  writers additive to achieve the same thing: last-server-payload-wins is what makes a workout
  deleted on another device disappear here.
  ([`2026-08-02-calendar-local-overlay.md`](../../overview/history-2026-07-30.md),
  [`2026-08-03-streak-local-overlay.md`](../../overview/history-2026-07-30.md))
