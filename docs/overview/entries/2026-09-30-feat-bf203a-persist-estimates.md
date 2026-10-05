# 2026-09-30 — BF-203a Task 5: storing an estimate, and a decline that clears one

**Branch:** `feat/bf203a-persist-estimates` · **Lane A** · server slice only; nothing writes an estimate yet.

## What shipped

- `PlanMealAnswer` carries `answer: 'no' | 'estimated'` and the six `est_*` fields.
  `rowToAnswer` used to hard-code `'no'`, so it now reads the real value.
- `upsertEstimatedAnswers` (slice, repository, adapter): inserts on the existing live-row unique
  index and does nothing where a live answer exists. It returns how many rows were new. An undone
  decline is a tombstone, so that slot can be estimated.

## The hole the plan did not see

`savePlanMealAnswer` revives an existing row by clearing `deleted_at`. When that row was an
**estimate**, declining the meal would have left `answer = 'estimated'` with its macros, still
counting in the day. Both the revive and the race-guard `ON CONFLICT` now write `answer = 'no'` and
clear every `est_*` column.

## Also filed

**LA-184** (Lane B): no caller passes `isTrainingDay` to the meal-plan card, so a split plan always
shows its rest variant. The estimator needs the same choice server-side.

## Verified

`bf203a-estimated-answers.test.ts` (real Postgres): writes, idempotence without re-derivation, no
estimate over a decline, a decline over an estimate, and an estimate after an undone decline. With
the plan-meal-answer and nutrition route suites: 66 passed. tsc and test typecheck are clean.
