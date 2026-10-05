# 2026-09-30 — BF-203a Task 8′ (1–2): the device writes estimates, and the server accepts them

**Branch:** `feat/bf203a-device-materialiser` · **Lane A** (engine + one hook, per the "both → A" rule).
Estimates are now RECORDED; **no total counts them and nothing displays them** until LA-185 is
answered (Task 8′ 3–4).

## What shipped

- **`packages/shared/src/nutrition/plan-variant.ts`:** `pickPlanVariant`, moved out of
  `meal-plan-section.tsx` so the card and the estimator use one chooser. `variantForEstimates` returns
  null for a split plan whose day type is unknown. The display fallback (rest) is harmless to look at
  and wrong to count.
- **`estimateSlotsFor`** (`meal-estimate.ts`): a variant's meals become slots, typed by LA-172's rule
  with close hours from `slotCloseHour`. A meal it cannot place in time is left out.
- **The device materialiser** (`use-plan-meal-logging.ts`): runs before the answers read, for today
  only and with a local store only. It writes each due estimate locally plus to the outbox, carrying
  its row id. `ActivePlanCard` now passes LA-184's `isTrainingDay` to the hook.
- **`loggedPositions` read `variants[0]`**, which is LA-184's sibling. It now uses the variant the card
  shows.
- **Push branch** (`adapter.ts`): an `answer: 'estimated'` mutation goes to `saveClientEstimate`. That
  runs the same two-level ownership join as a decline, then `upsertEstimatedAnswers` under the device's
  id. An estimate without calories is rejected per item and not retried. Before this, every
  `plan_meal_answers` mutation went to the decline path.

## Verified

- Unit: `plan-variant.test.ts`, three `estimateSlotsFor` cases. The LA-184 source pin now points at the
  shared chooser. Real Postgres: device push stored under its id, replay is a no-op, no estimate over a
  decline, missing calories and a foreign meal are both rejected. Nutrition, shared and local-store
  suites: 1084 passed. tsc, test typecheck and lint are clean, and `check:rules` ran 86 of 86.
- `pnpm dev` on the owner's snapshot, with a temporary plan created through the API:
  `/api/sync/push` stored the estimate under the device id, `GET /api/nutrition/plan-meal-answers`
  returned it with its macros, and declining it returned the same row as `'no'` with macros cleared.
  The plan and rows were removed afterwards.

## Not exercised

The materialiser itself, which runs only with a native local store (APK). The owner has no active plan,
so on his phone it does nothing until he makes one. Known-Issues row updated.
