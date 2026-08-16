# Handoff — 2026-08-05 · Quick-session time-budget and guided-walk cadence, triaged and queued

_Domain: `workouts` (also touches `cardio`) · Branch: `claude/workout-time-ai-prescription-lmbmuh` · PR: none yet, about to open_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/workouts/README.md` and `docs/domains/cardio/README.md` (those pillars' code,
> docs and open issues), then `docs/implementation-backlog.md` (the queue — Q-83, Q-84 are the
> two new entries this session added). This file covers only what *this* session did and what it
> leaves behind.

## Goal

The owner reported two things while looking at screenshots of the app: (1) a 30-min "Quick"
Push AI Prescription only included 2 of 5 exercises, and (2) the guided-walk "Walk complete"
summary shows pace but not cadence for its fast/slow interval blocks. Both were investigated to
root cause and queued per the standing backlog-driven protocol (planning session writes plan +
queue entry; implementation is a later session's job).

## Current status

- Build/test: not run — this was a **docs-only** session, no code touched.
- Device-verified: n/a, nothing shipped.
- Both root causes were verified by reading the live source on current `main` (file:line
  references below are real, not from memory or the plan docs' own claims).

## What shipped

Docs-only, all on branch `claude/workout-time-ai-prescription-lmbmuh`:

| What | Where |
|---|---|
| Q-83 plan | `docs/superpowers/plans/2026-08-05-measured-warmup-scale-with-preset.md` |
| Q-83 queue entry | `docs/implementation-backlog.md` (tagged `[workouts]`) |
| Q-84 plan | `docs/superpowers/plans/2026-08-05-guided-walk-cadence-in-summary.md` |
| Q-84 queue entry | `docs/implementation-backlog.md` (tagged `[cardio]`) |
| Domain index links | `docs/domains/workouts/README.md`, `docs/domains/cardio/README.md` |
| Journal | `docs/overview/entries/2026-08-05-time-budget-cadence-backlog-planning.md` |
| Status | `projectOverview.md` current-status bullet |

## Deliberately NOT done

- **Neither Q-83 nor Q-84 is implemented.** Per the backlog protocol this is a planning-only
  session — an implementer session takes the top of the queue later. Both plan docs end with an
  explicit task breakdown for that session, including "re-verify against current `main` first"
  since plans can go stale while queued.
- Q-83's plan deliberately does not pick a final numeric ceiling for the warmup-carve-out clamp —
  it names the shape of the fix (cap the measured warmup as a fraction of the *chosen* budget, not
  just an absolute-minute clamp) and leaves the exact fraction as an implementation-time decision
  to be tested against real preset combinations.
- Q-84's plan deliberately does not decide the visual hierarchy question (should cadence lead or
  follow pace on the fast/slow cards) — left as an implementation-time UI call.

## Key decisions (with rationale)

- **Q-83's fix targets the warmup-carve-out clamp, not the exercise-selection trimmer.** The
  2-exercise Quick-session outcome is itself working as designed
  (`dropToBudget()` in `packages/shared/src/ai-periodization/time-budget.ts:306-333` deliberately
  favors dropping whole exercises over cutting every exercise to a token 2 sets — "three exercises
  properly beats five badly"). The actual bug is that the *working budget it's trimming to* is
  smaller than intended, not the trimming logic itself. Don't "fix" this by loosening the trimmer.
- **Q-84's fix is scoped to surfacing existing data, not adding a new capture path.** Cadence
  capture, per-interval computation, and DB persistence all already exist
  (`lib/walk/segment-stats.ts`, `activity_logs.cadence_spm*` columns). The gap is exactly one
  function (`aggregateSegmentsByKind`) dropping a field it already has access to, plus three render
  call sites never reading it. No new native plugin, no new APK, no schema change.
- **Q-84 explicitly notes the ceiling on what this fix can do**: cadence will only be non-null when
  a Polar H10 strap is connected (validated path). Oura-ring cadence is gated off
  (`RING_CADENCE_VALIDATED = false` in `packages/shared/src/health/cadence.ts:218`, octave-ambiguous
  signal, unresolved) and GPS-only walks have no cadence source at all. Don't scope this fix as
  "always shows cadence" — it's "shows cadence when the data exists, same as pace already does."

## Gotchas / what did NOT work

- Nothing failed outright this session — both investigations converged cleanly. The one thing
  worth flagging: Q-84 initially read (from the screenshot alone) as "cadence is missing
  entirely," but the live walk screen (`components/guided-walk/walk-active.tsx:187`) already shows
  a live cadence readout — the gap is specifically the summary/per-interval surfaces, a narrower
  and cheaper fix than the first impression suggested. Don't over-scope the implementation to add
  cadence somewhere it already exists.

## Files to look at

- `packages/shared/src/workout/duration-model.ts:36-53` — `warmupBudgetMin()`/`workingBudgetMin()`,
  the Q-83 fix site.
- `packages/shared/src/workout/time-audit.ts:307-332` — `buildMeasuredTimeBudget()`, where the
  absolute (unscaled) warmup median is learned.
- `lib/walk/segment-stats.ts:84-118` — `KindAggregate`/`aggregateSegmentsByKind()`, the Q-84 fix
  site.
- `components/guided-walk/walk-summary.tsx` and `walk-segment-stats-card.tsx` — the three render
  call sites Q-84 needs updated (sibling-surface sweep).

## Open questions / blockers

None waiting on the owner — both items are ready for an implementer session to pick up as-is. The
open decisions noted above (warmup-clamp fraction, cadence card visual hierarchy) are scoped as
implementation-time calls within each plan, not owner blockers.

## Pickup prompt

```
Check out branch claude/workout-time-ai-prescription-lmbmuh (or main, if this session's docs-only
PR has already merged — check first). Read projectOverview.md, then docs/implementation-backlog.md
for the current queue state (this session added Q-83 and Q-84; if either has already been
implemented by another session, treat it as done and skip it — re-verify against main before
trusting this prompt).

If Q-83 is still at the top of the queue (or you're asked to work on the Quick-session time-budget
issue specifically): read docs/superpowers/plans/2026-08-05-measured-warmup-scale-with-preset.md
and docs/handoff-2026-08-05-workouts-time-budget-and-cadence-backlog-planning.md first, then
re-verify the plan's file:line references against current main (packages/shared/src/workout/
duration-model.ts and time-audit.ts) before implementing — the plan explicitly leaves the warmup-
clamp fraction as an implementation-time decision, so pick and justify a concrete number, add it,
write unit tests covering the three-preset matrix, and verify manually in pnpm dev.

If Q-84 is what you're picking up: read
docs/superpowers/plans/2026-08-05-guided-walk-cadence-in-summary.md. The fix is small — add
avgCadenceSpm to KindAggregate in lib/walk/segment-stats.ts, then render it at the three call
sites (walk-summary.tsx's KindAggCard and per-interval loop, walk-segment-stats-card.tsx's
KindColumn). Verify in pnpm dev with and without a connected cadence source (no Polar H10 in the
sandbox, so the no-source path is what's actually testable there — note that explicitly rather than
claiming the strap path was verified).

Either way: follow the standard backlog-implementer protocol in docs/implementation-backlog.md's
Protocol section — remove the completed item's queue entry in the same PR, journal entry +
projectOverview.md update before merging, version bump + changelog if user-visible.
```
