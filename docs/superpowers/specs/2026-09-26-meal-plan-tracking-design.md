# Meal-plan tracking — estimated meals and a weight-corrected estimator

**Status:** design agreed with the owner 2026-09-26. Not built. Implementation plan to follow.
**Domain:** `nutrition` · **Lane:** A (storage + engine) with a B surface
**Origin:** owner, 2026-09-26 — *"There is a meal plan tracking feature i wanna explain and have it added."*

---

## 1. What the owner asked for

Verbatim, condensed from his description:

> A meal plan that knows his activity, burn and goals, so the calorie target is derived (RMR +
> activity ± deficit) rather than typed. That target splits across his meals by count, macro split
> and timing, with more carbs around training. Each slot recommends food that fits, from meals
> tagged for that slot or what he has eaten at that time before, scaling portions to fit.
>
> Then: **when a meal window passes unanswered, assume it was eaten and fill it as an "estimated"
> meal**, with a prompt to say what it actually was. And — the part he called the key part —
> **use the next weigh-in to correct what those estimated meals really were.**

---

## 2. What already ships — measured 2026-09-26, before any design

Most of this feature exists. The measurement is recorded because it is what reduced the work from
"build a meal-plan tracking system" to three additions.

| Piece of the description | Already in the codebase |
|---|---|
| Target derived from goal, not typed | `goal-recommendation`, `reconcileDailyMacros`, `carbsFromRemainder`; protein per kg of **current** weight |
| Meals have windows | `meal_types.timeStartHour` / `timeEndHour` |
| Reminder at the window, with a skip action | `lib/meal-reminders.ts` (per-meal local notifications + end-of-day catch-up driven by `required`) |
| Per-slot target macros and a suggested time | `meal_plan_meals.targetCalories/targetProteinG/targetCarbsG/targetFatG`, `suggestedTime` |
| **"Did I eat this planned meal?"** | **`plan_meal_answers`** — keyed `(planMealId, logDate)`, with `answer`, `answeredAt`; mirrored in the local SQLite store and the export map |
| Adherence | `lib/nutrition/adherence.ts`, `computeAdherenceRatio` |
| **Carbs skewed around training** | `packages/shared/src/nutrition/meal-split.ts` — carbs biased to the pre/post-training meals, protein even, fat skewed away from pre-workout, each slot tagged `timingRole` |
| Recommending from previously-eaten food | queued as **`BF-183`** (tag My Foods rows with the meals they suit) |

**Nothing in section 1 needs building except the three items in §4.**

---

## 3. The measurements that shaped the design

These were run against the owner's own production data. They are recorded so the conclusions are
not re-litigated from intuition.

### 3.1 Single-day back-inference does not work

The owner's original request was for the next morning's weigh-in to reveal what a missed meal
actually was.

- 1 kg of fat ≈ 7,700 kcal, so a **missed 500 kcal meal is ~65 g** of real tissue.
- His day-to-day weight noise, **92 weigh-ins in 120 days**: median |Δ| **0.20 kg**, sd 0.37 kg,
  p90 0.50 kg. His weighing discipline is unusually consistent; this is close to the floor.
- **Signal-to-noise on a single day is about 1 : 3.**

### 3.2 The owner's directional framing is correct, and weak

He then reframed it: if the estimate assumed a deficit and weight rose, they probably ate more.
Tested over **61 day-pairs** where he logged food and weighed on both mornings:

| | |
|---|---|
| correlation, day's intake → next-day weight change | **r = +0.175** (r² = 0.03) |
| above-average intake days → next morning | −0.029 kg |
| below-average intake days → next morning | −0.098 kg |
| direction agreed with intake | **35/61 = 57%** (coin flip = 50%) |

The sign is right and the group gap (0.069 kg ≈ 530 kcal apparent) is about the size of a missed
meal. But a correction applied per-day would be **wrong roughly 4 times in 10**, making the estimate
noisier rather than better. The same 57% edge accumulated over a fortnight is reliable — so the
mechanism is the owner's, read over a window where it beats the noise.

**Caveat that must not be lost:** those 61 days are days he *did* log. Real-world signal on the days
this feature exists for will be no stronger.

### 3.3 Fat mass is modestly better than total weight

The owner asked whether body fat from the scale would isolate fat change. Tested on 97 consecutive-day
pairs, and the 60 of them with logged intake:

| signal | r vs intake | direction agreed | median daily noise |
|---|---|---|---|
| total weight | +0.175 | 60% | 0.250 kg |
| **fat mass** (weight × bf%) | **+0.217** | 60% | **0.179 kg** |

Fat mass is **28% quieter** and explains ~5% of variance against ~3%. It is not a clean separation,
because **the scale infers fat from impedance and impedance tracks hydration** — the noise is
relabelled, not removed. Across his full history body fat % has an sd of **2.26 pp**, which at 69 kg
is ±1.6 kg of apparent fat mass; his recent 60 days are better behaved (no overnight move above
1 kg), but the tail is real.

Consequences, all of which are in the design:
- fat mass is the **primary** corrector input, total weight the **agreement check**
- the estimator must be **median/trimmed, never a mean**
- 28% less noise means faster convergence — noise falls as √N, so the window may shorten
- CLAUDE.md records the scale **under-reads body fat by 3.2 points** against DEXA. A constant offset
  cancels when measuring *change*, but fat mass must never be surfaced as an absolute.

---

## 4. Scope — three additions

### 4.1 The estimate (data, Lane A)

`plan_meal_answers` gains an `estimated` answer state, the estimated macros, and the basis that
produced them (which bias value and window, so a stored estimate can be explained later).

**`food_logs` is not touched.** This is the load-bearing decision — see §5.

**⚠ One thing planning must settle first: `plan_meal_answers.answer` already defaults to `'no'`.**
So "unanswered" today is the *absence of a row*, not a value — and it is not currently distinguishable
from an explicit "no, I didn't eat it" once a row exists. The trigger in this section is written as
*no row and no matching food log*, which is correct for today's data, but the `'no'` default has to be
reconciled (is a defaulted `'no'` really an answer?) before the estimate state is added beside it.
Getting this wrong would either estimate over a meal the owner deliberately declined, or never
estimate at all.

**Materialised on read, never pushed.** There is no cron layer in this app (module-map §0), so on app
open and on local-day rollover, any plan meal whose window has passed with no answer and no matching
food log gets an `estimated` answer at its target macros × the current bias. This uses the documented
local-day-rollover pattern.

### 4.2 The resolve surface (Lane B)

An estimated row is tappable and offers: **I ate this** (confirm → `yes`), **I ate something else**
(pick from slot-tagged meals or usual-at-this-time → writes real food logs, answer becomes `yes`,
estimate cleared), **I skipped it** (`skipped`, contributes zero — distinct from estimated), and
**Add extras**. `BF-183` feeds the recommendation list when it lands.

The reminder notification already carries an action set; it gains the same choices so a meal can be
answered without opening the app.

Estimated entries **count toward the day's ring and "kcal left"** (owner's decision — a day with
nothing logged otherwise reads as 0 eaten, which is worse guidance) and render distinctly so the
assumed portion of the number is always visible.

### 4.3 The corrector (engine, Lane A)

A rolling-window estimator producing a single `estimateBias` in kcal/day.

- **Inputs:** fat-mass trend (primary), total-weight trend (agreement check), logged intake,
  estimated intake, RMR + activity.
- **Robust:** median or trimmed, never a mean (§3.3).
- **Applied forward only.** It shifts *future* estimates. It never rewrites a past answer, so history
  stays immutable and a day already reviewed does not change under the owner.
- **Disagreement days are dropped**, not learned from: when fat mass and weight move in opposite
  directions, that is a hydration event.

---

## 5. Architecture — and why the alternative lost

**The estimate is an answer against the plan meal, not a food log.**

`plan_meal_answers` already has the right key — `(planMealId, logDate)` — is already mirrored into
the local store, and already has an invalidation group (`nutrition-adherence`). Day totals merge
logs and estimated answers at `lib/health/energy-balance-service.ts`, which the nutrition domain
index calls *"the one server-side assembly — the route and the AI tool both call it"*, so the merge
has a single home rather than N.

**Why not a flagged `food_logs` row** (the rejected option, recorded so it is not revisited): it is
genuinely better at one thing — every existing surface (diary, ring, timeline, offline sync,
edit/delete) would work untouched, with one column. It loses because invented calories would then sit
in the table the maintenance estimator and adaptive TDEE read, and correctness would depend on every
consumer remembering a filter. This repo already carries two live energy-model defects — **`BF-137`**
(the maintenance estimator fitting a GLP-1 weight drop and calling it metabolic rate) and **`BF-138`**
(two energy models running at once, neither stated) — and CLAUDE.md's own rule is that a missed
row-mapper update *"fails silently"*. Approach A makes the failure **impossible by construction**
rather than by discipline.

**The circularity this prevents:** estimates → `food_logs` → adaptive TDEE → calorie goal → plan
targets → estimates. A closed loop with nothing outside it to catch drift.

---

## 6. Guard rails

- **Estimated calories are excluded from adaptive TDEE and the maintenance estimator**, asserted by a
  test rather than trusted to discipline.
- **`estimateBias` is capped** so one bad fortnight cannot run away.
- **A retatrutide titration change resets the window.** A drug-driven weight change is
  indistinguishable from an intake change, which is exactly `BF-137`'s live failure.
- **`skipped` and `estimated` are different states.** A skipped meal is zero; an estimated meal is a
  guess. Collapsing them would teach the corrector that a fast was an under-estimate.

---

## 7. Deferred to the owner — calibration, not architecture

Per CLAUDE.md, scoring calibration is the owner's and Tuning proposes it. These are **not** to be
picked by an implementer:

- the **window length** (measurement suggests 14 days, possibly ~7–10 on the fat-mass signal)
- the **bias cap** (kcal/day)
- the **agreement threshold** between fat mass and weight before a day is dropped

These ship as a `Lane: O` entry with recommendations, in the shape `BF-201` used. **The build is not
blocked on them** — defaults can be provisional and the entry replaces them.

---

## 8. Verification

- **Replay the corrector over the owner's ~120 days of history and state how many days it would have
  moved.** This is the standing bar for anything that changes numbers he reads daily, and it is also
  the honest test of whether the corrector works at all. A proposal without it is incomplete.
- A test asserting estimated answers are **absent** from the TDEE and maintenance inputs.
- Window-boundary tests at 23:59 / 00:01 in the user's timezone, per the repo's date rules, with the
  fixture anchored to the user-local day rather than a hardcoded stamp.
- Offline: an estimate materialises, resolves and syncs from the local store — verified on the APK,
  since `getLocalStore` returns null in the web sandbox.
- Device pass on the S25 for the resolve sheet and the estimated-row styling.

---

## 9. Explicitly not in scope

- Changing how the calorie target itself is derived — `goal-recommendation` stands.
- Rewriting past estimates from later data. Forward-only, by design (§4.3).
- Per-meal-type estimate policies. One behaviour for all slots until there is a reason.
- The recommendation engine itself — that is `BF-183`.
