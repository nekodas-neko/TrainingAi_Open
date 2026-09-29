# 2026-09-29 — LB-179: the run planner can tell a walk-satisfied prescription from a run

**Lane A · migration `202609282225` · local SQLite v44 · unblocks RV-166.**

- **Column:** `prescribed_runs.completed_as` ('run' | 'walk' | null), with a CHECK constraint. It is
  mirrored locally (CREATE, v44 ALTER, RECONCILE_COLUMNS), carried by the pull (`sync-engine`,
  `applyDelta`), and set by both write paths. Those are the web PATCH and the offline push branch,
  which share `PrescribedRunPatchBody` and `updatePrescribedRun`. The `claude_ro` view was
  regenerated from a scratch database built from the migrations alone; the diff is exactly the one
  column.
- **Two rules keep a stale 'walk' from outliving its day:** every status write sets the field to what
  the client sent or to null (a run), and the create upsert resets it on a regenerated
  prescription. **No backfill:** every existing completion was a run, which null already means.
- **Readers:** `completedAsRun` (`packages/shared/src/running/run-completion.ts`) now gates the
  hard-run gate, the week's 80/20 sequence and the run-type pace stats.
- **Found on the way:** the create upsert's conflict path rewrites the row's primary key. That is
  existing behaviour, and the test follows it rather than changing it.
- **Verified:**
  - Planner tests: a walk-completed tempo trips neither the gate nor the sequence, and a
    run-completed one trips both.
  - Route tests.
  - A real-Postgres test of the reset rules, the push branch and the CHECK constraint.
  - The claude_ro and snapshot suites: 34 run, none skipped.
  - `pnpm dev`: PATCH as a walk left easy-run stats at 0, the same completion without the field
    counted 1, and "swim" got 400.
- **Owed:** the v44 device migration (Known Issues row), and RV-166's client half, which must send
  `completedAs: 'walk'` (noted on RV-166).
