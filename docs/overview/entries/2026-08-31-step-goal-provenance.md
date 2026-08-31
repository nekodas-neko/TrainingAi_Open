# 2026-08-31 — the step goal: a decision already made, and two requirements it did not cover (Q-524 amended)

**Tuning · docs-only.** The owner challenged a recommendation to "just set it to 7,000" and was
right to. Q-524 amended; no new entry.

## The recommendation was worse than the owner's own prior decision

7,000 is `STEP_GOAL_BY_ACTIVITY.sedentary` — a population constant from Paluch 2022, **specific to
nobody**, and it does not even match the owner's `activity_level = 'moderate'` (which derives
10,000). Meanwhile **Q-524 already carries the owner's decision from 2026-08-19**: *"we need to use
1 number here. The AI should be able to define the number and allow for manual entry."*
`users.steps_goal` becomes the single source; `getDailyGoals()` reads it with the derived value as
fallback. **The design was settled twelve days ago and is simply unbuilt.** The lesson is procedural
and is now in the baton: check the entry for an existing owner decision before recommending anything.

## What the re-raise genuinely adds

**(a) Provenance.** The owner's *"if 1 is on, that should be the truth"* cannot be evaluated today:
`/api/nutrition-goals/recommend:326` and the manual editor **write the same column** with no record
of which. So an AI review can silently overwrite a deliberate choice, and no surface can say whether
the 7,000 on file is the owner's decision or a stale recommendation. Q-524's *"the AI half already
exists and needs no new work"* is true for computing the number and false for the precedence.
**Not an observed loss** — `last_goal_review_at` is 2026-08-25 against a newest
`goal_recommendations` of 2026-08-11 — a code shape, not an incident.

**(b) The derived number should come from energy, not a population band.** Five constants mean two
people at the same activity level get the same goal regardless of size, and **a step is not equal
work across people**: at the owner's 160 cm a stride is ~0.66 m, so 10,000 steps is **6.6 km** where
at 180 cm it is ~7.5 km — the same goal, ~14% more work.

| steps | km | net kcal |
|---|---|---|
| 4,649 (median day) | 3.09 | **86** |
| 7,000 | 4.65 | **129** |
| 10,000 | 6.64 | **184** |

**The entire 7k-vs-10k argument is worth ~55 kcal/day** to this owner, which is the right scale to
hold it at. Recommended shape: derive the goal from a *target net walking energy expressed as a
fraction of BMR* — the construction `activeEnergyGoal` already uses — so it scales with weight and
height and reuses an existing formula.

**Two traps recorded on the entry.** Do not target the whole `activeEnergyGoal` (373 kcal here;
12,000 steps yields 221, so it would demand ~20,000 steps/day). And the Activity Score already scores
`steps` (18) and `activeEnergy` (15) separately — an energy-derived step goal makes them count the
same walking twice.

## Verification

`pnpm check:rules` — see PR. `check-backlog-pointers` OK. **Failure surfaces not exercised: all of
them.** No code ran — SQL against production plus source reading; no `pnpm dev`, no device, no APK.
**The calorie figures are textbook walking-economy arithmetic (~0.57 kcal/kg/km, net of resting), not
a measurement of this owner** — `active_calories` is present on only 8 of 51 days, so they could not
be validated against observation.
