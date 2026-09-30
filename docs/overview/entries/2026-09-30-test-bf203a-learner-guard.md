# 2026-09-30 — BF-203a Task 7′: the maintenance model cannot learn from an estimate

**Branch:** `test/bf203a-learner-guard` · **Lane A** · test only.

The plan's Task 7 guarded `lib/health/maintenance-estimator.ts` and `lib/health/adaptive-tdee.ts`. Neither
file exists, so as written it would have passed while checking nothing. The real learner is
`packages/shared/src/nutrition/adaptive-tdee.ts`, fed by `computeEnergyBalance`, which builds today's
intake and the maintenance window from one `intakeByDate` map.

The guard asserts that the learner exists (a moved file fails the test), that it reads no plan-meal
answers or estimate macros, and that the assembly never puts anything into `intakeByDate` beyond the
food-log summary. The behavioural half lands with Task 8′, the first code that adds an estimate: a
balance built with an estimate must leave every window day's intake unchanged.

**Verified:** the new test passes (3 cases).
