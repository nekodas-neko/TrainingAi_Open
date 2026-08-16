# 2026-07-28 — Role ordering: the main lift is the hardest-worked movement again

**Branch:** `feat/role-ordering-plausibility` · **Version:** v1.232.0
**Plan:** [`docs/superpowers/plans/2026-07-28-role-ordering-plausibility.md`](../../superpowers/plans/2026-07-28-role-ordering-plausibility.md)
(planned and specced in #875, implemented here — the two-PR backlog protocol.)

## What was wrong

A production audit of every live prescription found one unambiguous inversion: Upper prescribed
**Skull Crusher 5×7 @77.5 %** against **Incline Bench 4×7 @76 %** — an accessory beating the primary
on both load *and* volume.

Two independent gaps caused it:

- **Load.** The "never out-load the heavy anchor" principle was already written in
  `generate-prescription.ts` and applied to `secondary` — but against the primary's *zone ceiling*
  (80 % here), not its *prescribed* percentage (76 %). At 77.5 % the accessory sat under the ceiling,
  so nothing bound. Accessories were capped at a flat 85 and never compared to the primary at all.
- **Volume.** `SET_CEILING` (primary 6 / secondary 5 / accessory 4) existed but was reached only
  through `expandToBudget` — i.e. only on the `long` duration preset. On a standard session the
  model could return any set count for any role and nothing checked it.

## What shipped

Per the owner's decision, the two axes behave differently rather than one rule spanning both:

| axis | rule |
|---|---|
| **Load** | Role order is **absolute** — nothing out-loads the session anchor. No exception. |
| **Volume** | Role order **yields to weekly need** — a muscle materially below its weekly target may carry more sets than its role normally allows. |

The reasoning: a lagging muscle is corrected with *volume*, never with a *heavier bar*. Loading an
isolation movement above the main compound is just a worse main lift.

- **`lib/ai-periodization/role-plausibility.ts`** (new) — `sessionAnchorRole()` and
  `capLoadToAnchor()`. Extracted rather than left inline so the load half is unit-testable; the
  generator previously wrapped it inside the AI call.
- **`applyRoleSetPlausibility()`** in `time-budget.ts` — applies `SET_CEILING` on **every** path,
  then caps non-anchor exercises at the anchor's set count unless their muscle is lagging. Lives
  there because it needs that module's weekly-volume model. Runs *before* the budget passes, so the
  plan is the right shape when trimming/expansion start rather than relying on them to repair it.
- **`LAGGING_RATIO = -0.25`** — a muscle a quarter below MAV. Reuses `muscleOverageRatio` rather
  than defining "behind" a second time.

## Three traps worth remembering

1. **The load cap cannot live in the existing pricing loop.** That loop walks exercises in *list*
   order; one program's primary sits **second**, so an in-loop cap would bind on three sessions and
   silently no-op on the fourth. It has to be a second pass over settled percentages.
2. **`muscleOverageRatio` returns the most *over*-target muscle**, so an exercise training one
   lagging and one already-maxed muscle does **not** qualify as lagging. Deliberate — you shouldn't
   buy a lagging muscle volume via a movement that hammers a maxed-out one — but it reads like an
   off-by-one. Don't "fix" it to `min`.
3. **No `?? 'primary'` fallback.** A session legitimately having no primary is confirmed program
   design. Exercises with no program role are excluded from the anchor calculation entirely rather
   than defaulted, or an unknown movement could invent an anchor for a session that has none.

## Verification

- 20 new unit tests across the two modules; full suite green (2380 passed).
- **Exercised end-to-end on the local dev server** — logged in as the seeded user and generated a
  real prescription through the changed path (200): primary 4×7 @76 %, primary 3×9 @68 %, accessory
  2×12 @66 %. Asserted programmatically: no load inversions, no set inversions, no ceiling breaches.
- **Not exercised:** the *binding* case on live data. The seeded program produced a compliant
  prescription (the rule had nothing to correct) and the model's output is non-deterministic, so
  proof that the cap actually clamps rests on the unit tests, which use the real production numbers
  (76 / 77.5). The other two seeded sessions returned "Baseline not complete" — a legitimate
  precondition, not a failure.
- **Not verified on device.** Server-side only, no native surface, so the APK behaviour is
  unchanged — but the re-audit of production prescriptions after the next generation cycle is what
  will confirm the real Upper inversion is gone.
