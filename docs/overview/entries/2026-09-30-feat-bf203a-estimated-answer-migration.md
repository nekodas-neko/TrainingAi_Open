# 2026-09-30 — BF-203a Task 1: `plan_meal_answers` can hold an estimate

**Branch:** `feat/bf203a-estimated-answer-migration` · **Lane A** · migration only, shipped alone per
the plan. `BF-203a` stays in the queue for Tasks 2–9.

## What shipped

- Migration `202609292220_plan_meal_answer_estimated.sql`: six nullable `est_*` columns, the
  `answer` CHECK widened from `('no')` to `('no', 'estimated')`, and
  `plan_meal_answers_estimate_shape` (an estimate carries calories; a decline carries none).
  Additive and reversible, and it rewrites no rows.
- `schema.ts` columns; `claude-ro-views.sql` regenerated from a scratch database built from
  migrations. The diff is exactly the six columns.

## Correction to the plan

The plan's migration added the shape constraint but never widened migration 187's
`CHECK (answer IN ('no'))`, so no estimate could ever have been inserted. It was caught by reading
the live constraint before writing the migration.

## Verified

- `bf203a-plan-meal-answer-estimated.test.ts` (real Postgres) passes, with the sibling meal-plan
  suites: 37 passed.
- `claude-ro-readonly-role` + `db-snapshot-integration` over TCP: 34 passed, none skipped.
- Applied to the owner's snapshot: it applied cleanly (he has no answer rows).
- tsc, test typecheck, and `check:rules` (84 of 84) all pass.

## Not exercised

Nothing writes an `estimated` row yet, so no reader has changed behaviour. The readers that assume
every row is a decline are called out on the entry, to fix before Task 5.
