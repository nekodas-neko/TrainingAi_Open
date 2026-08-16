## 2026-07-27 — Intervals goal (Norwegian 4×4)

Implements the "Intervals goal (Norwegian 4×4)" cardio backlog item
(`docs/superpowers/plans/2026-07-27-cardio-intervals-goal.md`), answering the owner's question "is
there any interval training plan in the running app?" Completes the running-system backlog sweep —
everything plannable from the owner's requests this session is now shipped.

### What shipped
- **A fifth selectable running-plan goal — "Intervals (Norwegian 4×4)"** — alongside the existing
  Speed/Endurance/Heart health/Recovery, running the well-known 4×4-minute high-intensity interval
  protocol (10 min warm-up + 4 × 4 min work at Zone 4-5 + 3 × 3 min active recovery + 5 min
  cool-down, capped at 2 sessions/week, easy/long fill on other days).
- **`lib/running/frameworks/norwegian-4x4.ts`** — a new `RunFramework`, registered in the existing
  swappable-framework registry (`lib/running/framework.ts`). The prescription engine was explicitly
  built for exactly this extension — `framework.ts`'s own comment says "add a new template by
  adding a module + a line here," and `cardio-goals.ts:6` already cited Norwegian 4×4 as one of the
  frameworks the interface was designed to support later. No migration, no new route, no recovery-
  gate changes — `goal_kind`/`framework_key` are free-text DB columns by design.
- **`GoalKind`/`CardioGoalMeta`/the plan-setup Zod enum** all extended with `'intervals'`.
  `PlanSetupSheet` needed zero UI code changes — it renders `SELECTABLE_CARDIO_GOALS` generically.
- **A genuine bug found and fixed during TDD**: the plan's draft test assumed a fresh plan (0 easy,
  0 hard runs this week) would prescribe an interval session immediately. It doesn't — the
  `canGoHard = easySoFar > hardSoFar` gate (mirrored from `speedVo2maxFramework`/
  `polarizedFramework`, both of which have the same behavior) evaluates `0 > 0` as false, so a fresh
  plan always eases in with an easy run first. Fixed the test to match the correct, existing-app-
  consistent behavior rather than special-casing the new framework to diverge from it.

### Verification
- 8 unit tests for `norwegian4x4Framework` (2 more than the plan's draft, split to correctly
  distinguish the fresh-plan-eases-in-first case) — full suite green (2254 tests).
- Manual/Playwright end-to-end: cleared the seeded test user's running plan, confirmed the empty
  "Set up my running plan" flow opens `PlanSetupSheet`, confirmed "Intervals (Norwegian 4×4)"
  renders as the fifth goal card with its blurb, confirmed selecting it does NOT show the
  target-distance picker (matches Heart health/Recovery), confirmed "Create plan" succeeds and the
  running screen updates to show "THIS WEEK'S ZONES · INTERVALS (NORWEGIAN 4×4)" with the correct
  first-prescribed "Easy run." Confirmed via `psql` the new `running_plans` row has
  `goal_kind = 'intervals'`, `framework_key = 'norwegian-4x4'`.
- Pure TypeScript, no offline-sync surface, no native/device-only code — fully verifiable in the
  sandbox, unlike the sibling run-status-chip plan.
