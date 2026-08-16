## 2026-07-27 — Baseline anchors + push sessions

Implements the sibling plan to the density-progression framework
(`docs/superpowers/plans/2026-07-27-cardio-baseline-anchors.md`), completing the
"Density-progression engine + anchors + test sessions" backlog item both plans were split from.

### What shipped
- **Baseline anchor.** A new `running_baselines` table (migration 146) freezes a snapshot of
  `resolveFitnessSnapshot()`'s output — VO2max, max/resting/threshold HR, weekly base minutes, plus
  an easy-pace-per-km derived via `pacesFromVdot` — at the moment a running plan is created. One row
  per plan (unique index on `plan_id`); a new plan always gets a fresh anchor, matching how
  `saveRunningPlan` already deactivates-and-replaces rather than mutating in place.
- **Push sessions (spec D-3).** Every 5th completed session in a plan (`isPushSession`,
  `lib/running/push-sessions.ts`) is now a "beat your best" session: the prescription's distance
  target bumps to 2% past the best same-environment outdoor run completed so far in the block, and
  the rationale switches to an explicit "Push session — you've covered X km... beat it" framing.
  Nothing new is stored — `isPushSession`/the best-distance lookup are derived at read time in
  `/api/running-plan` from existing `prescribed_runs`/`activity_logs` rows, per the project's
  "derive, or reconcile on read" rule.
- **Environment tagging (spec D-5).** `inferEnvironment` classifies a completed run as `outdoor`
  (has a GPS route polyline) or `indoor` (treadmill or no GPS) — purely derived, never stored — so a
  treadmill result never corrupts an outdoor "beat your best" comparison.
- **UI.** The running card shows an amber "PUSH" badge next to the run type when today's session is
  a push session.

### Verification
- 5 new unit tests for `isPushSession`/`inferEnvironment` — full suite green (2129 tests).
- Manual/API verification against the local dev DB: created a plan, confirmed via `psql` a matching
  `running_baselines` row (nulls for VO2max/pace since the test user has no fitness test on file —
  a valid case, the anchor never blocks plan creation on missing data).
- Seeded 4 completed sessions with GPS-bearing activity logs for a plan, backdated its `created_at`
  so the sessions fall within the plan's lifetime, then confirmed the 5th `GET /api/running-plan`
  call returned `isPushSession: true`, bumped the distance target from 4.50 km to 5.20 km (2% past
  the best seeded 5.10 km run), and showed the beat-your-best rationale. Confirmed via Playwright
  screenshot that the "PUSH" badge and rationale render correctly on `/running`.
- **Not verified:** a real 5-session push cadence over genuine calendar time (the seed can't produce
  5 genuinely-completed running sessions without manual DB seeding, as done above) or on-device
  (APK) — this PR touches no native/offline-sync code paths (no new field goes through the
  `prescribed_run` mutation domain), but the S25 smoke run hasn't been done.

### Deferred
Plateau handling (D-7) and block-end review (D-8) remain unplanned — they need real push-session
history to be meaningful, which this PR is the first thing to produce. Tracked as its own backlog
item, unchanged by this PR.
