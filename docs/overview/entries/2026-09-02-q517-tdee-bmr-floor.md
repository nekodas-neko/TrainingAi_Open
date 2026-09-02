# 2026-09-02 — Q-517: a maintenance below your own resting burn is impossible, not implausible

**Branch:** `claude/la-q517-tdee-bmr-floor` · **Agent:** Implementation Lane A

`adaptive-tdee.ts` opens by warning that an ungated estimate *"would tell the user their maintenance
is 1200 kcal — actively harmful advice"*, and then clamps at **1000**. The owner's worst window
computed **1052** and slipped through the 200 kcal gap between the module's own prediction and its
own floor. It is one tap from the calorie goal: `TdeeAdaptationCard` writes the accepted value
through `PUT /api/nutrition/targets`, which mirrors into `users.calorie_goal`.

The floor is now the user's own BMR, passed in rather than recomputed. Below it the window is
**rejected, not clamped up** — `resolveMaintenance` falls back to the formula baseline, and clamping
would report a number the data never supported. The new `below_bmr` exclusion is deliberately
separate from `implausible_result`: one says the food log is incomplete, the other says the
arithmetic left human range, and they want different words in front of the user. The universal 1000
survives as `max(MIN_PLAUSIBLE_MAINTENANCE, bmr)`, so a nonsense BMR cannot weaken the existing guard.

**The entry's addendum said to read `body_comp.bmr_kcal`; the call site already had better.**
`energy-balance-service.ts` resolves `personalRmr(measured) ?? comp.bmrKcal ?? mifflinStJeorBmr`
two dozen lines above — so the floor is the **measured** resting rate wherever one exists (BF-42),
which is the number the body-composition card renders. That also disposes of the addendum's fallback
problem (25 of 96 days have no `body_comp` row): there is nothing to fall back from, because this
resolution never returns null.

**What the entry did not notice, and it makes the case sharper.** The same file already floors
`restingBaseKcal` at BMR, one line below the change — *"a resting burn below BMR is not a number this
model is allowed to report"*. That floor protects what the energy balance **displays**. Nothing
protected the maintenance itself, which is what becomes the recommendation and then the goal. The
right rule was already written down and applied to the wrong quantity.

**It makes the estimate SAFE, not CORRECT** — the entry is explicit and it still holds. Survivors sit
well below the formula's 2,397, which is residual under-logging showing through. The durable fix is
detecting within-day incompleteness (a day with only breakfast still counts as fully logged, so a
50%-complete record clears a 70%-coverage gate), and that stays on the `Keep:` as a feature.

**Not exercised:** the local dev DB cannot drive this path end to end — `/api/nutrition/energy-balance`
compiles and answers 401 on `pnpm dev`, but there is no seeded user with 14 days of completed food
logs and four weigh-ins, so the gate was verified by unit test rather than by a live response. Seven
tests, three of which fail when the floor is reverted (mutation-checked). No device path, migration
or schema is touched.
