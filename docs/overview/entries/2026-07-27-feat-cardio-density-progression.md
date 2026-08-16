## 2026-07-27 — Density-progression running framework + two prescription bug fixes

Implements the first of the two plans the density-progression backlog item was split into
(`docs/superpowers/plans/2026-07-27-cardio-density-progression.md`); the sibling
`2026-07-27-cardio-baseline-anchors.md` plan is next, now unblocked by Task 8 below.

### What shipped
- **Fixed-time running option.** Setting up a running plan now offers a choice between "Grows over
  time" (existing behaviour — sessions get longer) and "Fixed time" (pick 20/30/45/60 min; the same
  time budget every session, with the target distance growing ~3%/week instead). New
  `density-progression` framework (`lib/running/frameworks/density-progression.ts`) approximates an
  easy pace from the user's VO2max estimate via `pacesFromVdot` (previously wired to zero callers)
  and computes a distance target from the fixed duration. `RunningGoal` gained
  `timePerSessionMinutes` (`running_plans.time_per_session_minutes`, migration 145); the prescribed
  distance now renders on the running card whenever a framework sets one.
- **Two pre-existing bugs found during research, fixed as prerequisites:** `weekIndex` was hardcoded
  to `0` in `/api/running-plan`'s `assembleInputs()`, so no framework's week-over-week growth has
  ever actually run in production (`lib/running/week-index.ts` computes the real value from the
  plan's `createdAt`). `ctx.goal` was a hardcoded fake `{kind: 'cardio_health', ...}` regardless of
  what the user's plan actually specified — now built from the persisted `plan` row.
- **Completion round-trip.** The Running screen's "Start run" button only navigated to `/activity`
  without ever calling `startActivity()` — a separate pre-existing bug found during implementation,
  confirmed via `grep` showing the only real caller was the unrelated generic activity-picker sheet.
  Fixed so `onStart` calls `startActivity('run', ...)` first, then `linkPrescribedRun(id)` (ordering
  matters: `startActivity`'s `INITIAL_STATE` spread would otherwise wipe the linked id).
  `useActivityStore` gained `prescribedRunId`; `DoneActivityScreen` now marks the linked
  `prescribed_runs` row `completed` with its `activityLogId` on save (both the local-store and the
  web-fallback path), reusing the existing `prescribed_run` mutation domain verbatim — no sync-chain
  changes. Also invalidates the running-plan cache after linking, matching the existing skip/complete
  write path.

### Verification
- 6 new unit tests for the framework, 5 for `weekIndexSince` — full suite green (2124 tests).
- Manual/Playwright end-to-end: created a plan via the wizard (goal "Go further" + fixed 30 min),
  confirmed via `psql` the row persisted with `framework_key = density-progression`,
  `time_per_session_minutes = 30`; confirmed the resulting card showed "30 min · 4.50 km target"
  with the weekly zone breakdown matching the framework's 15/70/10/5 split exactly. Separately drove
  the full Start → active → Finish → Save flow and confirmed via `psql` that
  `prescribed_runs.status` flips to `completed` with `activity_log_id` pointing at the new
  `activity_logs` row.
- **Not verified:** real multi-week growth. The dev seed can't fast-forward calendar time, so
  `weekIndex > 0` behaviour was only checked via the unit tests and a manually backdated
  `running_plans.created_at` row, never a real multi-week user history. Not verified on-device
  (APK) — this PR touches no native/offline-sync code paths (Task 8 reuses the existing
  `prescribed_run` domain unchanged), but the S25 smoke run hasn't been done.
