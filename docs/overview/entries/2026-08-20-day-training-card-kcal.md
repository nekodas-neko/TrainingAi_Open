# 2026-08-20 — Q-391: the day screen's Training card shows what each session burned

**Branch:** `feat/day-training-card-kcal-stat` · **Lane B** · v1.333.0

The owner, twice in two days, with a screenshot each time: *"i want the calories burned showed per
event; so on the training; next to volume, exercises, sets."* The contrast in the screenshot was the
report — the ACTIVITY card below showed `101 kcal` and the workout above it showed nothing.

Lane A shipped the server half on 2026-08-19: `activeBreakdown.workoutKcalBySession: { id, kcal }[]`
on `/api/nutrition/energy-balance`. This is the render.

## The three decisions the entry left open, and how they went

**Where the number comes from.** Not a second estimate — **the addends of the total already on the
same screen**. The Energy section's "Workouts" row and these cards are now the same numbers, so they
cannot disagree by construction rather than by a second calculation agreeing by luck. That is the
principle `energy-summary.ts` was built on: *"the day screen disagreeing with Nutrition about how
much was burned is worse than either being slightly off."*

**Joined on session id, never name.** The Training card grouped by `sessionName`; a name is not
identity, and repeating a session in one day would have collided the two cards on the key. It groups
by `workoutSessionId` now, which `/api/day-log` already exposes per exercise.

**Labelled `~639` / `EST. KCAL`.** The tilde and the "est." are load-bearing. Unlike the three stats
beside it, this is *not* derived from the sets — it is a flat MET tier over the session's clock (or
the HR regression when a strap was worn), so a 49-minute session moving 2,364 kg and one moving
800 kg produce the same figure. The owner settled the placement; the label is what stops it reading
as a fourth measured fact.

**Absent, not zero, when it cannot be computed.** No addend means no stat — a confident `0 kcal`
next to three real numbers is indistinguishable from a real one (the Q-278 class).

## Rounding is at render, deliberately

`workoutKcalBySession` returns the values **unrounded**, and `energy-summary.ts` says why: rounding
each addend and rounding their sum are different numbers. Three sessions at 120.4 render as 120 each
under a "Workouts 362" row. Half a kcal per card is the accepted drift; compounding it inside the
helper would not be. A test asserts the parts sum exactly to the total and that the *rendered* drift
stays within half a kcal per card.

## Verification

Exercised on `pnpm dev`, day detail for 2026-08-16, with the consistency requirement checked on the
real screen rather than only in fixtures:

- `/api/nutrition/energy-balance` returned `workoutKcal: 639` and
  `workoutKcalBySession: [{ id, kcal: 639.1968… }]` — one unrounded addend, keyed by id.
- The Training card rendered **`~639` / `EST. KCAL`** in the stat row beside Volume / Exercises /
  Sets, and the ENERGY section's **Workouts** row on the same screen read **639**. They agree.
- Zero console errors.
- 12 tests on `energy-summary`, five of them new, **mutation-checked**: keying by name instead of id
  fails three, and rounding inside the helper fails two.
- 4,341 unit tests · 50 of 50 custom rules · `tsc` clean · lint 0 errors.

**Not verified:**
- **The calorie VALUE is from a stub MET table.** The real vendored constants are gitignored and
  absent from every sandbox (**Q-361**), so `lib/oura-models/constants/` here holds a placeholder I
  wrote. The 639 above came from the **heart-rate** path, which is pure arithmetic and needs no
  table — so the plumbing, the join, the rounding and the agreement are all real, and the number a
  production MET fallback would produce is not something this environment can show.
- **No device run.** JS-only; reaches the APK on the next Railway deploy with no rebuild.
- **The two-same-named-sessions case was not reproduced.** Grouping by id makes the cards correct,
  but `workoutDurations` is still name-keyed upstream and would still collide — filed as **Q-362**,
  inferred from the route's own type rather than observed.
