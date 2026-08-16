# 2026-08-12 — A planned meal can be logged in one tap

**Release:** v1.299.0 · **Domain:** nutrition · **Branch:** `feat/log-planned-meal`
**Q-187, first slice** — the half that needs none of phase 2's machinery.

Until this, a plan told you what to eat and then played **no part in the day**. The plan card and the
day's food were two stacks on one screen that never spoke.

## Why this is the shippable half

Q-187's full prefill fills the day in automatically, which forces a *"prefilled but unconfirmed"*
state into existence — otherwise the energy-balance bar reports food nobody ate. That state has to
be designed, stored, synced, and filtered out of every existing reader of `food_logs`. It is the
expensive half and it is right to do properly.

**None of it is needed when the user taps a button, because the tap is the confirmation.** No new
state, no new table, and nothing can count toward the day's totals unless they said they ate it.

## Two decisions worth keeping

**Each ingredient is logged at a 100 g serving with the weight in the quantity**, not as a serving of
exactly that portion. That is the difference between the library gaining *"Cooked quinoa"* — a thing
you can log again at any weight — and gaining *"Cooked quinoa (236 g)"*, useful once and clutter
forever.

**Which meals are already logged is derived, not stored.** A plan meal has no per-day row, and
inventing one just to remember a button press is the start of exactly the unconfirmed-row design
phase 2 must do properly. Matching on the ingredient names the meal would write is enough to stop an
accidental double-log, and it self-corrects: delete the food and the button comes back.

The bucket is the meal's own `mealTypeId` when it has one, otherwise **its suggested time rather than
the current hour** — logging the 07:00 breakfast at 3pm should still land under breakfast. That
picker is now shared with the saved-meals sheet, which had its own copy of the same logic.

## Verification

`tsc` clean · 0 lint errors · 17/17 custom checks · **454 files / 3,741 tests green** (4 new).

Driven end-to-end in the browser at 412×915: expanded the plan card, tapped **I ate this**, and the
plan card's own protein bar moved **29.3% → 62.6%** with the meal switching to a **Logged** state.
The only console error in that run was `POST /api/oura/sync 400`, which is the dev seed having no
Oura token — unrelated.

`nutrition-content.tsx` crossed the 800-line check, so the logic was extracted to
`use-plan-meal-logging.ts` (811 → 773).

## Not exercised

- **Not verified on device.** `logFoodEntries` takes the local-store + outbox branch on the APK and
  the web POST branch here, so the branch that matters on the phone is the one that did not run.
- No migration, no schema change, no sync-path change — it reuses the existing `food_logs` and
  `food_items` outbox domains.

## What is left of Q-187

The automatic prefill, with the per-meal yes/no and the unconfirmed state. Its backlog entry now
carries this slice as shipped and describes what remains.
