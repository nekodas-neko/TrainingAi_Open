# Role-ordering plausibility — an accessory should not out-work the main lift

**Status:** planned 2026-07-28, NOT implemented. **Owner decision taken 2026-07-28 — see §5, this
is now specced and ready to build.**
**Origin:** the AI-prescription review (`2026-07-28-ai-prescription-review.md`) flagged Upper
prescribing Skull Crusher 5×7 @77.5 % against Incline Bench 4×7 @76 %, and deferred it as needing a
role-ordering rule that does not exist. This is that rule, costed.

---

## 1. What production actually shows

Every live prescription, ordered by the exercise's position in its session, with the stored role:

| session | role | exercise | prescribed |
|---|---|---|---|
| Push | primary | Barbell Bench Press | 4×5 @82.5 % |
| | secondary | Landmine Press | 2×7 @77.5 % |
| | secondary | Cable Chest Dips | 2×7 @77.5 % |
| | accessory | Dumbbell Lateral Raise | 2×10 @70.5 % |
| | accessory | Tricep Cable Combo | 2×10 @70.5 % |
| Pull | primary | Sumo Deadlift | 4×7 @77.5 % |
| | secondary | Bent-Over Barbell Row | 4×9 @72.5 % |
| | secondary | Barbell Shrug | 3×9 @72.5 % |
| | accessory | Pull-Up | 2×10 @70.5 % |
| | accessory | Dumbbell Preacher Curl | 1×10 @70.5 % |
| Legs | secondary | Barbell Hip Thrust | 1×9 @72.5 % |
| | **primary** | Barbell Squat | 4×7 @76 % |
| | secondary | Barbell Romanian Deadlift | 1×9 @72.5 % |
| | accessory | Barbell Calf Raise | **2**×12 @66 % |
| | accessory | Hanging Leg Raise | 2×12 @66 % |
| Upper | primary | Incline Bench Press | 4×7 @76 % |
| | secondary | Cable Pulldown | 3×9 @72.5 % |
| | secondary | Barbell Overhead Press | 3×9 @72.5 % |
| | **accessory** | **Barbell Skull Crusher** | **5×7 @77.5 %** ← more sets AND heavier than the primary |
| | accessory | Cable Preacher Curl | 2×10 @70.5 % |
| Lower | secondary | Single Leg Hip Thrusts | 4×8 @75 % |
| | secondary | Dumbbell Bulgarian Split Squat | 3×8 @75 % |
| | secondary | Barbell Good Morning | 2×8 @75 % |
| | **accessory** | Dumbbell Forearm Curl | **3**×10 @70.5 % ← more sets than the secondary above |
| | accessory | Cable Crunch Abs | 1×10 @70.5 % |

**Only one case is unambiguous: Upper's Skull Crusher, which beats the primary on both axes.**
Be careful with the rest:

- **Legs' "violation" dissolves on its own.** Calf Raise 2 sets vs RDL 1 set was only an inversion
  because the RDL was stuck at a single set — the bug fixed in #874. Once RDL floors to 2 it ties.
  A rule written against this row would be solving an artefact.
- **Lower's Forearm Curl 3 vs Good Morning 2** is a genuine set inversion, though both are light.
- **Lower has no primary exercise at all**, and Legs' primary sits at position 2, not 1.
  **Owner-confirmed 2026-07-28: both are deliberate program design, not a misconfiguration.** So the
  rule must (a) have a defined answer when no primary exists, and (b) key off `exercise_role` only —
  **never list position**. A rule that assumed "the first exercise is the anchor" would silently
  mis-handle Legs.

---

## 2. Why it happens — two currencies

Compounds and accessories are priced in different units, deliberately
(`lib/ai-periodization/generate-prescription.ts`):

```ts
if (role === 'accessory') {
  // priced by target EFFORT — load floats to hit goal RPE at the settled reps
  const pct = pctForExpectedRpe(accessoryTargetRpe(goal), a.reps)
  ex.pct = Math.min(85, Math.max(40, pct))            // ← flat 85 cap
} else if (role === 'secondary') {
  // …cap at the primary zone's ceiling so a secondary can climb toward —
  // but never out-load — the heavy anchor.
  ex.pct = Math.min(primaryCeil, Math.max(clampPrescribedPct(a.pct, exZone), effortPct))
}
```

**The principle is already written down**, in that comment, and already applied to `secondary`. It
is simply not applied to `accessory`, which is capped at a flat 85 instead.

**But extending the existing cap verbatim would NOT fix the observed case.** `primaryCeil` is the
primary's *zone ceiling* — 80 % for powerbuilding accumulation. Skull Crusher's 77.5 % is under it.
The primary was prescribed **76 %**, comfortably below its own ceiling. To catch this you have to cap
against the primary's **actually prescribed** percentage, not its zone ceiling — a materially
stronger constraint, and a different rule from the one already in the file. That is the decision.

**Sets have no role rule at all.** `SET_FLOOR` (2) is a trimming floor; `SET_CEILING`
(primary 6 / secondary 5 / accessory 4) exists but is consulted **only by `expandToBudget`**, i.e.
only on the `long` duration preset. On a standard session the model may return any sets 1–10 for any
role, and nothing reorders them.

---

## 3. Options — load (pct)

**L1. Cap accessories at the primary's zone ceiling.** One line, mirrors `secondary` exactly,
consistent with the stated principle. **Does not fix the observed case** (77.5 < 80). Low risk, low
value on its own.

**L2. Cap accessories and secondaries at the primary's *prescribed* pct.** Fixes Upper. Strong and
easy to reason about: nothing in the session is loaded heavier than the main lift. Risk: on a
realisation-phase day the primary sits at 87.5–92.5 % for 2–4 reps while accessories legitimately
run 65–75 % — the cap never binds, so it costs nothing there. It binds mainly in accumulation, which
is where the problem is. **Needs a fallback where a session has no primary (Lower).**

**L3. Cap by expected RPE rather than pct.** The honest comparison — 5×7 @77.5 % on a skull crusher
genuinely is harder than 4×7 @76 % on an incline bench, and pct alone doesn't say that. Most correct,
most machinery, and the existing `expectedRpe` helper already gets partway there.

---

## 4. Options — sets

**S1. Hard monotonic ordering:** `primary ≥ secondary ≥ accessory`, clamping the lower roles down.
Simple and predictable. **Training risk: this is wrong in some phases.** A strength realisation
primary is deliberately 3×2; lateral raises at 4×15 are not an error. Forcing accessories down to 3
would remove volume the programme wants.

**S2. Apply the existing `SET_CEILING` on every path, not just `expandToBudget`.** Bounds the shape
(accessory ≤ 4) without forcing monotonicity. Catches Upper's 5 → 4. Doesn't catch Lower's 3-vs-2,
and doesn't need one. Smallest change with a real effect; reuses a constant that already exists and
was already reviewed.

**S3. Cap non-primary sets at the primary's prescribed sets.** Directly targets inversions. Same
phase risk as S1, plus the no-primary fallback problem.

**S4. Rank by effort-weighted volume** (`sets × reps × pct`) and require the primary to lead. Closest
to the real training concept, and would catch cases where an accessory wins on volume without winning
on either raw axis. Most machinery; hardest to explain in a card rationale.

**S5. Do nothing on sets.** Defensible: the only clear inversion is Upper's, and S2 catches it as a
side effect. Volume-by-role may simply not be a rule worth having.

---

## 5. Decision (owner, 2026-07-28) and the resulting spec

> *"I agree with no it should never; as well as yes, when it's a lagging muscle — I think for now
> let's go with this. The goal is to be smart and weekly volume aware. This will be useful during our
> shorter and longer sessions."*

Both halves are right, and they are not in conflict once **load and volume are separated** — a
distinction §3/§4 above kept blurring by treating "hardest-worked" as one axis:

| axis | rule | rationale |
|---|---|---|
| **Load (pct)** | **Role order is absolute.** Nothing out-loads the session's anchor, ever. | A lagging muscle needs more *volume*, not a heavier *load*. Loading an isolation movement above the main compound is never the right answer to "biceps are behind" — it is just a worse main lift. This is the "no, never" half. |
| **Volume (sets)** | **Role order yields to weekly need.** An exercise whose muscle is materially under its weekly target may carry more sets than its role would normally allow. | This is the "yes, when it's a lagging muscle" half, and it is the mechanism by which the session actually corrects an imbalance. |

Applied to the observed case: Skull Crusher loses the heavier load unconditionally (77.5 % → capped
at the primary's prescribed 76 %), and keeps its 5th set **only if triceps are genuinely behind for
the week**. That is the owner's answer, exactly.

### 5.1 Defining "lagging" — reuse what already exists

`muscleOverageRatio` (`lib/ai-periodization/time-budget.ts`) already computes, per exercise,
`(projected_weekly_sets − MAV) / MAV` weighted by the exercise's muscle role (main 1.0, secondary
0.5), projected from sets already logged this week **plus** this session's contribution. Negative =
under target. It is already the currency `fitToBudget` trims by, already tested, and normalises small
and large muscles onto one scale.

**Do not add a second definition of "behind".** A muscle is lagging when its overage ratio is at or
below `LAGGING_RATIO` — a new named constant, suggested **−0.25** (25 % below MAV). Stating it as a
constant matters: it is the knob that decides how eagerly the app breaks role order.

**Two things about that function will bite the implementer, both verified in source 2026-07-28:**

1. **It returns the *worst* (maximum) ratio across the exercise's muscles** — the most *over*-target
   one (`time-budget.ts:94`, `ratio > worst`). So an exercise that trains one lagging muscle **and**
   one already-over muscle reports the over-target number and does **not** qualify as lagging. That
   is correct and deliberately conservative — you should not buy a lagging muscle extra sets by way
   of a movement that simultaneously hammers a muscle already past MAV — but it reads like an
   off-by-one. **Do not "fix" it to `min`.** If a future case genuinely needs the under-target
   muscle to win, that is a separate decision with its own evidence, not a quiet flip of a
   comparison operator.
2. **`muscleOverageRatio`, `wouldBreachMrv`, `SET_CEILING`/`roleCeiling` are all module-private** to
   `time-budget.ts` — no `export`. The rule runs at generation (`generate-prescription.ts`), a
   different module. Prefer moving the role-plausibility pass *into* `time-budget.ts` beside the
   trim/expand code it shares a model with, over exporting four internals outward; that also keeps
   the weekly-volume currency in one file, which is the point of §5.4.

### 5.2 Bounds — the exception must not run away

The volume exception is permitted only within all three existing guards:

1. **`SET_CEILING` per role** (primary 6 / secondary 5 / accessory 4) — an accessory may exceed the
   *primary's* count but never its own absolute ceiling. **This constant is currently consulted only
   by `expandToBudget`; it must apply on every generation path** (that is option S2, still needed).
   Verified 2026-07-28: `SET_CEILING` is declared at `time-budget.ts:163` and reached only through
   `roleCeiling` inside `expandToBudget` — there is no other call site, so a standard-preset session
   is bounded by nothing today.
2. **MRV headroom** — `wouldBreachMrv` already refuses volume a muscle cannot recover from. A lagging
   muscle is by definition far from MRV, so this rarely binds, but it is the backstop.
3. **The time budget** — `fitToBudget` still runs afterwards and can trim the earned set back out.
   Ordering matters: the exception grants the set, the budget may reclaim it.

### 5.2a Where each half actually goes — read this before writing code

Traced in `generate-prescription.ts` 2026-07-28. The two halves land in different places, and the
load half has a trap:

**Load — must be a SECOND PASS, not folded into the existing loop.** The role-pricing block
(`generate-prescription.ts:376-412`) walks `parsed.exercises` **in list order**, pricing each
exercise as it goes. Capping an accessory against "the primary's prescribed pct" inside that loop
only works if the primary has already been priced — i.e. only if it comes first in the list. **Legs'
primary is second**, so an in-loop cap would work on Push/Pull/Upper and silently do nothing on Legs.
This is the abstract "never key off list position" warning with teeth: it is not enough to *read*
role from `exercise_role`; the cap has to run **after every exercise is priced**, in its own pass
over the settled pcts.

**Sets — slot in at `timedExercises` (`:429-446`).** That array is built immediately before the
budget passes and already carries `role`, `sets` and `muscleGroups`, which is the entire input the
lagging rule needs. It flows straight into `dropToBudget`/`fitToBudget`/`expandToBudget`, so applying
`SET_CEILING` and the lagging exception there covers **every** preset in one place — which is what
"on every generation path" (S2) concretely means, and is the strongest argument for putting the pass
in `time-budget.ts` per §5.1.

**One caveat on role itself:** `:437` defaults to `role: sig?.role ?? 'primary'` when an exercise has
no matching signal. So a session can *appear* to have a primary that does not exist in the program.
`sessionAnchorRole()` must derive the anchor from the **signals** (the real `exercise_role` data),
not from this post-fallback array, or Lower could resolve an anchor out of a defaulted value and
defeat the whole no-primary branch.

### 5.3 Sessions with no primary (Lower) — confirmed intentional

Cap load against **the highest role present in the session**, not against "the primary". With no
primary, Lower's secondaries are the anchor and its accessories cap against them. Implement as a
`sessionAnchorRole()` helper rather than an `?? 'primary'` fallback, so the no-primary case is
explicit and tested rather than incidental.

### 5.4 Why this pays off in short and long sessions — the owner's stated goal

The weekly-volume machinery is already the currency at both ends of the duration feature, so this
change makes all three consistent instead of adding a fourth idea:

- **Short** — `fitToBudget`/`dropToBudget` already cut the muscles furthest **over** target first.
- **Long** — `expandToBudget` already adds sets to the muscle furthest **below** target first.
- **New: generation** — role order now yields for the same under-target muscles, so the plan is
  already shaped correctly *before* trimming or expansion runs, instead of relying on them to repair
  a shape the model chose blind.

The practical effect on a 30-minute day: the lagging muscle's work is what survives the cut, rather
than being trimmed because its exercise happened to be tagged `accessory`.

## 6. Verification a future implementer must do

- Re-run the §1 audit against production and confirm **load** inversions are gone everywhere, and
  that any surviving **set** inversion is explained by a genuinely lagging muscle (print the overage
  ratio alongside, so "it's lagging" is shown rather than asserted).
- Assert the no-primary path explicitly with a Lower-shaped fixture — it is deliberate design, not
  an edge case, and `?? 'primary'` would paper over it.
- Assert role is read from `exercise_role` and never from list position (Legs' primary is second).
- Confirm the rule does **not** bind in a realisation phase (primary heavy/low-set, accessories
  light/high-set) — an easy way to get this wrong is to silently strip accessory volume year-round.
- The prescription card renders `role` next to each exercise, so any clamp is user-visible; check the
  rationale text still reads honestly when a clamp has fired.
