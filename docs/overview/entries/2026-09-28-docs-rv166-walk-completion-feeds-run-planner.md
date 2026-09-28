# 2026-09-28 — RV-166 stopped before it shipped a planner bug; the engine half filed as LB-179

**Lane B.** Branch `docs/rv166-walk-completion-feeds-run-planner`. Docs only — no code, no version bump.

## What happened

`RV-166` was next in the Lane B queue, approved by the owner on 2026-09-27 with a mockup, and fully
specified. Re-verifying it against `main` before building — which is the standing rule and is the only
reason this was caught — turned up two things the entry did not have.

## 1. The root cause, which the entry never identified

`RV-166`'s title is *"no prescribed run has ever been marked done"*. The mechanical reason is **two
lines**: `components/activity/done-activity-screen.tsx:285` and `:322`, both
`if (activityType === 'run' && prescribedRunId)`. The owner logs walks, so `linkPrescribedRun` never
fires.

Everything the completion needs already exists — the `prescribed_runs.status`/`activityLogId` columns,
the `prescribed_run` outbox domain, the local-store write, and `PATCH /api/running-plan/runs/[id]`. So
this was never missing plumbing. It is a type guard, which makes the remaining build the card, not the
mechanism.

## 2. The reason it is not a two-line fix — and this is the finding

`prescribed_runs.status` is read by **the planner**, not only by display, and nothing records *how* a
row was satisfied. Three readers, all found by sweeping for readers rather than by reading the entry:

| Reader | What a walk does to it |
|---|---|
| `assemble-plan-context.ts:81` | `HARD_RUN_TYPES.has(r.runType)` feeds `hoursSinceLastHardRun`, its own comment calling it *"real no-back-to-back-quality protection"*. A treadmill walk completing a prescribed tempo tells the gate a quality session happened and **suppresses the next one**. |
| `assemble-plan-context.ts:97` | `runsThisWeek` — the 80/20 sequence and weekly frequency. A walk advances the framework toward an interval day. |
| `run-type-stats/route.ts:35` | Pulls `distanceKm`/`avgPaceSecPerKm`/`avgHr` off the linked log, filed under the **prescribed** `runType`. A ~12 min/km walk lands in "easy run" pace stats. |

**The decisive detail is a comment already in the file.** `assemble-plan-context.ts:97` reads *"Only
COMPLETED runs count toward the week's 80/20 sequence — a never-run pending row … must not advance the
framework toward an interval day (E2-7)"*. This repo has already been bitten by a non-run advancing the
framework and fixed it. `RV-166` as approved walks a walk straight through the same guard by a
different door. The first reader is worse than a wrong statistic: it changes what the app tells him
to do.

The entry and the mockup both warn *"this changes stored numbers … quantify how far before merging"*.
Neither names a reader, and neither mentions the planner. That warning was about adherence and streaks.

## What shipped

Docs only, in the queue:

- **`LB-179`, `Lane: A`** — the engine half, placed at **position 10** for Lane A (below every
  security item above it, inside `next-item.js`'s ten-row default view, because an entry that blocks an
  approved build is no use at rank 25 where it first landed).
- **`RV-166`** gains the root cause and `Needs: LB-179`, so it now parks for Lane B rather than looking
  startable. Verified with `next-item.js`, not by reading: RV-166 moved to PARKED, LB-179 prints at 10.

## The recommendation on LB-179, and why

**Record how the prescription was satisfied on the row (`completedAs: 'run' | 'walk'`) rather than
re-deriving it per reader.** The completing client knows the activity type at the moment it links the
row; every reader otherwise joins back to the activity log for a fact that was known when it was
written. `assembleInputs` **does not fetch activity logs at all** — its `Promise.all` takes prescribed
runs, loads, workouts, sleep and Oura — so deriving means adding a query to a hot path and repeating it
in three readers now and every reader later. It also matches the convention `RV-166` itself cites:
`observed-hr.ts`'s `source: 'observed' | 'estimated'`.

The alternative is written into the entry with what it is genuinely better at: deriving from
`log.activityType` ships today with no migration, and for `run-type-stats` — which already loads the
logs — it is a one-line filter. It loses on the two planner readers, which is where the defect is.

It needs a migration and a local SQLite version, so it is **Lane A's alone** per the standing rule, and
that is why this is a hand-off rather than something I built.

## Deliberately not done

- **No backfill**, and the entry says so: every existing `completed` row was necessarily a run, because
  the link only ever fired for `activityType === 'run'`. `null` means *satisfied before this was
  tracked* and reads as a run.
- **The card is not built.** `RV-166`'s *Today's cardio* card, the zone-stated criterion, the
  `Walk it` route sheet and the `estimated` marking all remain its own work, once `LB-179` lands.
- **The "how many days move" figure is not measured.** `RV-166` still owes it before merging; nothing
  here answers it.

**Not exercised:** no code changed, so nothing was run beyond the doc gates and the queue tools. The
three readers were established by reading source and their own comments, not by observing a walk
complete a prescription on a device — that observation is `RV-166`'s to make once it is buildable.
