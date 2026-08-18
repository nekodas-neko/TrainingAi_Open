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
| Metrics | `lib/health/activity-score.ts`, `step-estimate.ts`, `hourly-movement.ts`, `daily-summary.ts`, `daily-goals.ts`, `daily-medians.ts` |
| Step capture (border with `devices`) | `lib/oura-ble/step-counter-pipeline.ts`, `step-orchestrator.ts`, `step-orchestrator-core.ts`, `step-day-buckets.ts`, `step-features.ts`, `gait-step-count.ts` |
| UI | `app/activity/`, `components/activity/` |
| Tables | `body_metrics` (steps), `oura_daily` (activity score, active calories, activity times) |

## Reference docs

- [`docs/reviews/2026-08-15-comprehensive-app-review.md`](../../reviews/2026-08-15-comprehensive-app-review.md)
  — §1.2 measured the Activity Score in production after v2: sd 5.9 over 19 days, range 66–91, 10
  distinct values. **v2 fixed the mechanism Q-137 blamed and the outcome did not move** (Q-277),
  and the score exists on only 19 of 40 days (Q-278).
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
grep -n '\[activity\]' docs/implementation-backlog.md   # no queue items today
```

Live at the time of writing (2026-07-30, plus the 2026-08-07 entry below):

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

- 🔴 **Q-139 — `resolveDsToMs` compresses ring time by up to 18× during a backlog drain**
  (found 2026-08-07, queued, needs one owner decision). Anchor lag spans 56.2 min over one day, and
  interpolating between two anchors that disagree squeezes 28.5 min of ring time into 95 s —
  producing 60 s step windows of 1,555 steps. Totals are roughly preserved (+474 on the worst
  measured day); *placement* is not. **Blast radius is steps only** — sleep/HR/temperature use
  `measuredAtMs`, a fixed slope that cannot compress. **Blocks Q-71**, whose plan is to roll this
  same converter out to those paths and would therefore spread the defect.

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
  [`docs/../overview/history-2026-08-07.md`](../../overview/history-2026-08-07.md)
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
