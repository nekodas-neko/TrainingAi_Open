# Handoff — 2026-08-07 · Ring-clock compression found behind a step-count report

_Domain: `activity` (also touches `devices`, `platform`) · Branch: `claude/samsung-health-step-tuning-gqjs2j` · PR: see below_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> [`docs/domains/activity/README.md`](domains/activity/README.md) (that pillar's code, docs and open
> issues), then [`docs/implementation-backlog.md`](implementation-backlog.md) — **Q-139**, filed
> directly above Q-71. This file covers only what *this* session did and what it leaves behind.

## Goal

The owner reported that the app's step count reads higher than the Samsung Health phone count
(app **4,176** vs phone **3,376**, both read at ~21:49 on 2026-08-07), said the difference was
acceptable, and asked whether any tuning could close it. The session was asked to read today's real
step data and answer.

## Current status

- **Build/test:** no code was changed, so nothing to build. `pnpm dev` was **not** run and no test
  suite was executed — this was a data-analysis session over production frames. The one temporary
  vitest file used to replay the pipeline was deleted before committing.
- **Device-verified:** not applicable — nothing shipped to a device. The analysis is **server-side
  only**: production frames replayed through the real pipeline in the sandbox. Nothing was observed
  on the S25.
- **Everything in this PR is documentation.** Three markdown files. Steps are unchanged, the bug
  described below is still live, and merging changes no behaviour.

## What shipped

| Change | Where |
|---|---|
| Known-Issues row for **Q-139** (the ring-clock compression bug) | `projectOverview.md` |
| Backlog entry **Q-139** — decision-ready: what it fixes, what it does not, cost of inaction, three options with trade-offs, implementation direction | `docs/implementation-backlog.md` (filed directly above Q-71) |
| **Q-71 re-scoped** — a pointer explaining that implementing it as written would trade its own offset error for Q-139's compression error | `docs/implementation-backlog.md` |
| Next-free-Q bumped 139 → 140 | `docs/implementation-backlog.md` |
| Q-139 summary + this handoff linked | `docs/domains/activity/README.md` |

## The finding (so it is not re-derived)

**The step gap was not a bug.** 2026-08-07's steps are 100 % `step_counter` over ring frames:
`body_metrics.source_map->>'steps'` is `oura_ble`, and `step_live_windows` has held **no row since
2026-07-28**, so no phone or Health Connect value is in the mix. The ring reading higher than a
pocketed phone is the expected direction.

**A separate, real bug turned up.** A clock anchor is `(batch max ds, server receive time)`, so its
lag (`anchorUtcMs − anchorDs × 100`) is however long that batch took to arrive. `resolveDsToMs`
(`lib/oura-ble/clock.ts:70`) interpolates linearly between the two bracketing anchors, so the local
time-scale is `Δutc / Δds`. While the ring drains buffered history, ds outruns the wall clock and
that ratio collapses.

| | measured on real production frames |
|---|---|
| anchor-lag spread over the day's ds range (n=99) | **56.2 min** (sharp lower edge: p0→p10 is 1.4 min) |
| worst compression | Δds 17,094 = **28.5 min** of ring time → **95 s** of wall clock (~18×) |
| paired windows in one 60 s block (should be 2) | 79 @ 11:42 · 70 @ 10:41 · 66 @ 14:01 · 60 @ 17:11 |
| resulting 60 s step windows | **1,555** · 664 · 268 steps (top = 26 steps/second) |
| corrected clock (fixed 100 ms/ds, min-lag offset) | **zero** implausible windows; 2026-08-07 4,178 → 4,652; 2026-08-06 1,232 → 1,245 |

**The reproduction is exact:** replaying the rollup's own `computeStepsByDay` over the same anchors
and frames returns **4,178** against the stored **4,176**. Nothing above is inferred.

## Key decisions (with rationale)

- **Did not implement the fix.** It needs an owner decision (three options in Q-139), and per the
  backlog-driven protocol a non-trivial fix is planned in one PR and built in another.
- **Did not apply a step scale factor.** Correcting the clock moves the ring *further* from the phone
  (4,652 vs 3,376), so a factor would be fitting a fudge to a single day of paired data. If a
  calibration is ever wanted, collect several days of paired ring/phone counts first.
- **Recommended option 2** (fix forward, no backfill), with the read-only `previewStepsBackfill` run
  first so the size of the 35-day drift is known before deploy rather than after.
- **Claimed Q-139, not Q-117.** A parallel full-app review (#1127) claimed 117–138 on `main` mid-session.
  That review was checked and does **not** cover this finding — the two are independent.

## Gotchas / what did NOT work

- **The blast radius was wrong in the first draft, and was corrected.** The initial write-up (and the
  first thing told to the owner) said a fix would move sleep boundaries and HR bins. **It will not.**
  There are two converters and only one compresses:

  | Converter | Used by | Failure mode |
  |---|---|---|
  | `resolveDsToMs` (interpolates) | `lib/oura-ble/step-day-buckets.ts` → the steps rollup write **and** `previewStepsBackfill`; `app/api/oura-ble/step-counter-export` | **Q-139** — time-scale collapses during a drain |
  | `measuredAtMs` (fixed 100 ms/ds slope, one anchor) | sleep session start/end, HR bins, temperature, and the rollup's own `dayForDs` | Q-71 — whole timeline offset; **cannot** compress |

  Verify with `grep -rn "resolveDsToMs" --include=*.ts lib/ app/` before believing any claim about
  what a clock change touches.
- **A first pass used `oura_raw_samples.measured_at` as an independent time source. It is not
  independent** — it is stamped from the same anchor logic and carries the identical 56.21-minute
  spread. It also produced a different per-window picture than production (2,643 vs 4,178) purely
  because it changed day membership. **Reproduce with the real anchors and `computeStepsByDay`, or
  the numbers will not match production.**
- **`claude_ro` table names differ from the app's.** The anchors table is
  `claude_ro.oura_ble_clock_anchors`, not `oura_clock_anchors`. `oura_raw_samples` has no
  `created_at` — use `measured_at` or `recorded_at`.
- **`/api/admin/db-query` truncates at 1000 rows.** Page with `LIMIT/OFFSET`; today's step frames
  alone are ~2,900 rows and the anchors table is ~3,200.
- **Do not trust a partial-day replay.** An early run suggested 2026-08-05 was inflated (881 vs a
  stored 5,909); it was an artefact of the ds window not covering the whole day (254 windows vs ~560
  for a full day). That day was **not** verified either way.
- The console output of a vitest run is suppressed without `--reporter=verbose --silent=false`.

## Files to look at

- `lib/oura-ble/clock.ts:70` — `resolveDsToMs`, the defect.
- `lib/oura-ble/step-day-buckets.ts` — `computeStepsByDay`, the only production consumer.
- `lib/oura-models/inference/step-counter.ts` — `resampleSteps` folds steps into fixed 60 s
  wall-clock blocks; this is what turns compressed time into an impossible step rate.
- `packages/shared/src/health/step-estimate.ts` — `mergeStepCounterWithLive` applies
  `isPlausibleStepWindow` to **live** windows only; model windows go through unfiltered. Sibling gap,
  worth folding into the same fix.
- `lib/data/postgres/adapter.ts` — the steps write. The monotonic guard
  (`mergedSteps > existingSteps`) means the rollup's 35-day recompute can only ever *raise* a stored
  total, so a clock fix is **not** "future days only": recent days drift upward, and days that should
  come down stay inflated without an owner-gated `allowStepsDecrease` pass.

## Open questions / blockers

- **Blocked on the owner:** which of Q-139's three options to take (leave it / fix forward /
  fix + destructive backfill). Recommended: option 2.
- **Only two days were measured** (2026-08-06 and 2026-08-07). The size of the drift across the full
  35-day rollup window is unknown; `previewStepsBackfill` would answer it read-only.
- **Q-71 should be re-scoped after Q-139 is decided**, so one converter serves both paths rather than
  two conversions being maintained.

## Pickup prompt

```
Work in the TrainingAI repo on branch `main` (this line of work has merged; start a fresh
branch from a freshly-fetched main).

Read, in order:
  1. projectOverview.md — status and the Known Issues section; find the Q-139 row
     ("resolveDsToMs compresses ring time by up to 18x during a backlog drain").
  2. docs/domains/activity/README.md — the activity pillar's code map and open issues.
  3. docs/handoff-2026-08-07-activity-ring-clock-compression.md — the investigation that
     found it, including the traps that will otherwise cost you an hour.
  4. docs/implementation-backlog.md — entry Q-139, filed directly above Q-71.

Context: a 2026-08-07 session investigated why the app's step count read higher than the
Samsung Health phone count. The step gap itself is NOT a bug and needs no tuning — the ring
legitimately counts movement a pocketed phone misses, and correcting the clock moves the two
FURTHER apart, not closer. The investigation instead found a real fault in the ring clock:
resolveDsToMs interpolates between clock anchors whose lag varies by 56 minutes over a single
day, so during a backlog drain it maps 28.5 minutes of ring time into 95 seconds. The step
resampler then folds those windows into one 60-second block, producing counts of 1,555 steps
per minute. Totals mostly survive; placement does not.

Nothing has been fixed. The 2026-08-07 session was documentation-only.

FIRST ACTION: do not start coding. Q-139 is blocked on one owner decision — which of its three
options to take (leave it / fix forward with no backfill / fix plus a destructive
allowStepsDecrease backfill). The entry recommends option 2. Ask the owner to choose, and offer
to run previewStepsBackfill first as read-only evidence of how far the 35-day rollup window
would drift.

Constraints you would otherwise rediscover:
- Blast radius is STEPS ONLY. resolveDsToMs is used only by lib/oura-ble/step-day-buckets.ts
  and the admin step-counter-export route. Sleep, HR and temperature use measuredAtMs, a fixed
  100ms/ds slope that carries an offset error but structurally cannot compress. Verify with
  `grep -rn "resolveDsToMs" --include=*.ts lib/ app/` before believing otherwise.
- The rollup recomputes 35 days but the write guard is monotonic (mergedSteps > existingSteps),
  so a clock fix is NOT "future days only" — recent days drift upward and days that should come
  down stay inflated. Say this out loud before any deploy.
- Do NOT implement Q-71 first. As written it moves sleep/HR/temperature onto resolveDsToMs,
  which would spread this compression to those paths. Q-139's fix is also the right fix for
  Q-71; they should land as one converter.
- oura_raw_samples.measured_at is NOT an independent time source — it carries the same 56-minute
  anchor distortion. Reproduce with the real anchors via computeStepsByDay or your numbers will
  not match production.
- /api/admin/db-query truncates at 1000 rows; page with LIMIT/OFFSET. The anchors table is
  claude_ro.oura_ble_clock_anchors and oura_raw_samples has no created_at column.
- Steps are an offline-first domain, so the device-verification gate applies: green `pnpm dev`
  is necessary and never sufficient. All existing analysis is server-side replay only; nothing
  has been checked on the S25.
```
