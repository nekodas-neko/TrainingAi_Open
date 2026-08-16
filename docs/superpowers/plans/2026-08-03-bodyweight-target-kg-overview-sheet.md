# Bodyweight `target80` Rendered as "X kg" in the Workout-Preview Sheet (Q-55)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix a third, unfixed instance of the bodyweight-1RM-as-kg bug found in
`docs/reviews/2026-08-03-cross-domain-bug-review.md` (§4). v1.252.4 fixed the Year-in-Review PR
selection and the deload sheet's kg target — a bodyweight `estimated_1rm`/`target80` is a
`BW_REF`(100)-relative index, not a real weight, so printing "kg" after it fabricates a number. That
fix was scoped to the two surfaces found, not a blanket sweep.

**Tech stack:** `components/overview-screen.tsx`, `packages/shared/src/1rm.ts` (`repMaxFromOneRm`,
`BW_REF`).

## Evidence

`components/overview-screen.tsx:484` (the workout-preview sheet's Target column, populated from
`previewExercises` / `WorkoutExercise[]` fetched from `/api/workout-data`) renders
`` `${snapWeight(ex.target80)} kg` `` unconditionally, with no `exerciseType` check. The correctly-
guarded reference pattern is 70 lines above in the **same file**
(`overview-screen.tsx:409-414`): `ex.exerciseType === "bodyweight" ? repMaxFromOneRm(...) reps : ... kg`.
`target80` is `estimated1rm * 0.8` (`packages/shared/src/1rm.ts:74`) — for a bodyweight exercise
that's 80% of the `BW_REF=100`-relative index, not a weight. Concrete failure: open the workout-
preview sheet (tap a session card on the overview screen) for a session containing a bodyweight
exercise with a good rep max — its `target80` prints as e.g. "80 kg", a number with no relation to
anything the lifter has moved.

Already confirmed **not** broken (no fix needed): `live-1rm-readout.tsx`'s only render site
(`active-workout-screen.tsx:644`) guards on `exerciseType !== "bodyweight"` and computes its value
live from the currently-dialed weights rather than from a stored index.

## Tasks

- [ ] **Task 1.** In `components/overview-screen.tsx` around line 484, apply the same guard pattern
      already used at lines 409-414: for a bodyweight exercise, render the rep-max form (via
      `repMaxFromOneRm` or whatever helper the :409-414 block uses) instead of `` `${snapWeight(ex.target80)} kg` ``.
      Reuse the exact same formatting/wording as the :409-414 block for consistency within the file.
- [ ] **Task 2 — sibling sweep.** Grep `components/` and `app/` for other renders of `target80`,
      `estimated_1rm`, `estimated1RM` that might share this gap (the review's agent already checked
      this once and found only this one instance beyond the two already fixed — re-confirm before
      closing, since a second pass sometimes catches what the first missed, but don't expand scope
      beyond verifying, not hunting for unrelated bugs).
- [ ] Local dev-server pass: open the workout-preview sheet for a session with at least one
      bodyweight exercise (seed data has some — check `test@local.dev`'s program), confirm the Target
      column shows reps not kg for that row, and still shows kg correctly for weighted exercises in
      the same sheet.
- [ ] Run the full test suite + lint.
- [ ] Remove this entry from `docs/implementation-backlog.md`, add the journal entry +
      `projectOverview.md` update in the same PR.
