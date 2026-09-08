# 2026-09-08 — the four heart-rate reads get tests, and the trap finds its general form (PS-39)

**Branch:** `test/hr-read-routes` · **Lane A** · PS-39, coverage ratchet **66 → 62**.

## What shipped

`lib/__tests__/hr-read-routes.test.ts` — 31 cases over `hr-profile`, `health/hr-recovery-profile`,
`workout/exercise-hr-trend` and `oura/hr-data`. No product change.

Batched because they are the app's four answers to "what was my heart doing", and three share one
`days`-clamping idiom whose bounds nothing checked. Now pinned:

- **`resolveHrProfile` is left REAL and driven through the repository**, so the resolution is
  exercised rather than stubbed — this route used to run its own `computeObservedHr` +
  `resolveMaxHr` pass alongside it, which is how the codebase got divergent answers to "what is my
  max HR".
- **The reserve is floored at 30**, so a bad resting reading cannot collapse it and make every beat
  read as max effort.
- **An observed max is used only when reliable AND at least the age estimate.** A corroborated max
  below the estimate is a quiet month; an uncorroborated spike above it is noise.
- **`targetAnchorMax` is not the ceiling.** It anchors *reachable* targets, so it follows what was
  reliably hit even when that sits below the estimate — the one place the two deliberately disagree.
- **`oura/hr-data` reports a failed snapshot write rather than logging it.** A `console.error` is
  invisible in production, which is how that write failed on every recap for months with no symptom:
  the recap renders either way.
- **An aged-out workout falls back to the snapshot**, flagged `fromSnapshot`, and the rest-window
  HRV is filled from it separately because RR dies at 90 days while the trace lives to 180.

## The trap, and its general form

Three of 37 mutations survived the first pass, and all three were one shape: **every fixture where
the resolved ceiling happened to equal the age estimate could not tell the two apart.** So
`reserve`, `workingMax` and `targetAnchorMax` were all silently readable from `estimatedMax`
instead, and three mutations swapping the source changed no answer. A fourth and fifth, written
afterwards against `targetAnchorMax`, found it was never asserted at all.

That names the general form, now recorded in PS-39: **when two quantities are equal in your fixture,
nothing that reads either one is under test.** The fix was one case where the observation wins —
200 bpm reliable against a 184 estimate — which separates them and puts all three derived values
under test at once.

This is the same defect as the previous three batches wearing different clothes, which is the
argument for having written the checklist down rather than against it.

## Not exercised

Web/Node only. `computeWorkoutHr` is stubbed for `oura/hr-data` (its own repository fan-out is not
this route's logic), while `resolveHrProfile` is deliberately real. No device run: server routes with
no native, safe-area, gesture or notification surface, and the repository is mocked, so no Postgres
path and no drifted production data.
