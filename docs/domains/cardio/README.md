# Cardio — domain index

**Owns:** runs and walks as discrete sessions, GPS/pace/elevation and route rendering, cadence and
gait, VO₂max and VDOT, training stress (TSS/OTS), the cardio baseline fitness tests, the running
prescription coach, the cardio hub/trends/picker surfaces, and guided walk.

**Does not own:** whole-day step totals ([`activity`](../activity/README.md)) or HR capture
([`devices`](../devices/README.md)). Cadence is a shared border: the ring/strap signal is
`devices`, the cadence *metric* and its walk/run interpretation are `cardio`.

## Code

| Area | Where |
|---|---|
| Running & walking | `lib/running/`, `lib/walk/` |
| GPS & routes | `lib/activity/gps-tracking.ts`, `gps-watchdog.ts`, `route-encoding.ts`, `route-hr-zones.ts`, `scrub.ts`, `treadmill-utils.ts` |
| Cadence & gait | `lib/activity/cadence-tracker.ts`, `use-cadence-tracking.ts`, `gait-confirm.ts`, `lib/health/cadence.ts`, `gait-classifier.ts` |
| Fitness & load | `lib/health/vo2max.ts`, `vdot.ts`, `training-stress.ts`, `cardio-trends.ts`, `session-picker.ts`, `fitness-tests.ts`, `lib/fitness-tests/` |
| UI | `app/cardio/`, `app/running/`, `app/baselines/`, `components/cardio/`, `components/running/`, `components/guided-walk/`, `components/cadence/` |

**ACWR has exactly one implementation** (`computeVolumeAcwr`) and clients render the route's
`interpretation` rather than re-banding numbers — see [`docs/module-map.md`](../../module-map.md) §6.

## Reference docs

- [`docs/reviews/2026-08-16-multi-user-load-test.md`](../../reviews/2026-08-16-multi-user-load-test.md)
  — §5: `avg_pace_sec_per_km` is populated on **7 of 46** activity logs while **39 carry both
  duration and distance**. Read from the column, never derived, written as an explicit null at save —
  same shape as Q-230, likely one fix for pace/steps/calories together (Q-307).
- [`docs/reviews/2026-08-15-pillar-model-soundness-review.md`](../../reviews/2026-08-15-pillar-model-soundness-review.md)
  — §2: `running_baselines` is written at plan creation, holds **0 rows**, and `getRunningBaseline`
  has no callers outside the repository layer, so 12 prescribed runs never consulted a baseline
  (Q-301). The pace/HR model across 47 activity logs is **still unreviewed**.
- [`docs/gait-movement-domain.md`](../../gait-movement-domain.md) — **start here** for cadence and
  gait: the domain map and what each signal can and cannot tell us.
- Plans: `ls docs/superpowers/plans/*cardio*` (13 today), plus
  `docs/superpowers/plans/2026-07-20-cardio-system-remaining.md` for what's left.
- Backlog initiatives: the **Cardiovascular system redesign** and **Guided walk** sections of
  [`docs/implementation-backlog.md`](../../implementation-backlog.md) are owner directives.

- Reviews: [`docs/reviews/2026-08-07-full-app-review.md`](../../reviews/2026-08-07-full-app-review.md) — **full-app deep review, 2026-08-07** (saving/caching/performance/logic across all 201 routes and 40 pages; 53 findings queued as Q-117…Q-138, plus root cause for Q-73 and mechanisms for Q-72/Q-107)

## Open issues

```bash
grep -n '^### .*\[cardio\]' projectOverview.md   # 36 entries today — the largest health pillar
grep -n '\[cardio\]' docs/implementation-backlog.md   # 2 queue items today
```

Live at the time of writing (2026-07-30):

- 🟡 **Ring cadence is octave-ambiguous, not flat** — still gated off; the strap path is
  validated end to end (64 → 150 spm) but the ring path is not.
- ⚠️ **D-2 is not closed** — the ×60 scale factor was indicated by a single window and an earlier
  journal entry over-claimed it.
- **`localToActivityLog` drops display fields for unsynced activities** — pre-existing, shared
  with `platform`.
- ~~A Guided Walk showed as generic "Outdoor walking" on the home timeline~~ **fixed 2026-08-05
  (Q-94, v1.266.5)** — the timeline route now checks for the guided-walk-only `segments` column
  before its generic run/walk keyword collapse.
- ~~Auto-detection could double-log during an active Guided Walk~~ **fixed 2026-08-05 (Q-95,
  v1.266.6)** — `dispatchGate()`'s existing workout-in-progress suppression now also checks
  `isGuidedWalkActive`/`isActivityActive`. Not confirmed on a real device against a live
  significant-motion/ring-cadence trigger.
- Guided walk GPS/pace, per-segment stats, the elevation profile, the run execution screen, the
  cardio hub/trends/picker and the baseline fitness tests are all shipped but **not
  device-verified**; several were only ever exercised on single-week or single-run data.
- **Q-88 shipped 2026-08-06 (v1.267.5):** a "lazy-day credit" card on the Cardiovascular screen
  shows Zone 1 minutes moved on days with no dedicated workout/cardio session — a new, separate
  signal, not a change to D-10's existing exclusion of Zone 1 from the training quota or the
  Activity Score's active minutes (both untouched). Outcome:
  [`entries/2026-08-06-zone1-lazy-day-credit.md`](../../overview/entries/2026-08-06-zone1-lazy-day-credit.md).
- **Q-99 shipped 2026-08-06 (v1.267.6):** Guided Walk's preset carousel is now Long / Short /
  Custom — Custom persists the lifter's own sets/fast/slow setup, and editing a stepper away from
  Long/Short now correctly shows Custom selected instead of silently misreporting the old preset.
  Outcome:
  [`entries/2026-08-06-guided-walk-long-short-custom-presets.md`](../../overview/entries/2026-08-06-guided-walk-long-short-custom-presets.md).
- **Q-98 bug-fix half shipped 2026-08-06 (v1.267.7), ⚠️ NOT device-verified:** `applyOverride`
  (Running screen swipe-to-pick-a-different-run-type) now writes through the local store the same
  way `markRun` does — fixes a real APK-only race where a stale `'skipped'` row clobbered the
  reset back after a swipe, invisible on web. The failing path is unreachable in this sandbox (no
  native SQLite here); only the unaffected web path was verified. Outcome:
  [`entries/2026-08-06-running-plan-override-local-write.md`](../../overview/entries/2026-08-06-running-plan-override-local-write.md).
- **Q-98-followup (redesign) shipped 2026-08-07 (v1.267.10):** the run-type carousel now shows a
  themed icon + HR-zone-coloured badge per type (reusing `HR_ZONE_META`, no new illustration
  assets), and the separate Skip button/`markRun` machinery is gone — swiping to a different type
  already resets status via `applyOverride`. Deliberately did not fold Start into every slide or
  remove `PrescribedRunCard` — that panel's AI-rationale/gate-warning content doesn't map onto a
  small slide, and a Start button per slide alongside a persistent one would be redundant. Outcome:
  [`entries/2026-08-06-running-screen-carousel-imagery.md`](../../overview/entries/2026-08-06-running-screen-carousel-imagery.md).
- **Q-84 shipped 2026-08-05 (v1.265.0):** the guided-walk summary's fast/slow cards, per-interval
  table and history card now show cadence, and it **leads** the pace it used to be missing beside —
  falling back to pace when no strap was connected. `avgCadenceSpm` was already computed per segment
  and was being dropped at the kind-level rollup. **`walkEffortDisplay()`
  (`lib/walk/segment-stats.ts`) is the one place that decides which of the pair headlines** — three
  surfaces render it, so do not restate the rule at a call site. Plan:
  [`2026-08-05-guided-walk-cadence-in-summary.md`](../../superpowers/plans/2026-08-05-guided-walk-cadence-in-summary.md);
  outcome: [`entries/2026-08-05-guided-walk-cadence.md`](../../overview/entries/2026-08-05-guided-walk-cadence.md).
  **Not verified with a real strap walk, and the rendered layout was not observed** — see the
  `projectOverview.md` Known-Issues row.

## History

- Handoffs: `ls docs/handoff-*-cardio-*.md` — most recent:
  [`docs/handoff-2026-08-06-cardio-owner-ui-bug-batch-continuation.md`](../../handoff-2026-08-06-cardio-owner-ui-bug-batch-continuation.md)
  (owner UI-bug batch continuation — Q-93/Q-92/Q-91/Q-90 shipped this session across app-shell/
  heart-rate/sleep; Q-88/Q-87/Q-86 next, then Q-98/Q-99). Plus
  [`docs/handoff-2026-08-05-workouts-time-budget-and-cadence-backlog-planning.md`](../../handoff-2026-08-05-workouts-time-budget-and-cadence-backlog-planning.md)
  (filed under `workouts`, also covers Q-84 — guided-walk summary cadence, triaged and queued, not
  yet built) and
  [`docs/handoff-2026-08-03-cross-owner-bug-batch-triage.md`](../../handoff-2026-08-03-cross-owner-bug-batch-triage.md)
  (Q-66 — guided walk treadmill/no-GPS mode; Q-68 — auto walk/run detection false positives),
  filed under `cross` because it spans five pillars.
- Journal: `grep -rl 'cardio\|guided.walk\|cadence\|VO₂\|vo2' docs/overview/entries/`

## Gotchas specific to this domain

- **Cadence has been wrong in three different ways** (band-pinning, octave ambiguity, ×60 scale) —
  any cadence change needs a real capture at two or more cadences, not a synthetic frame.
- **Full-screen cardio flows are navless**, so bottom-anchored controls need `pb-safe-action-lg`,
  not bare `pb-safe` — the 2026-07-19 fitness-baseline regression.
- **GPS elevation and the local-SQLite sync path have never been verified on real data.**
