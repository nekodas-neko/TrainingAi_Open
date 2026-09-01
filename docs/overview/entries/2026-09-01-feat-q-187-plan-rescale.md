## 2026-09-01 — the meal plan recalculates against what was actually eaten (Q-187, v1.428.0)

**Branch:** `feat/q-187-plan-rescale` · **Lane:** B

The owner, in the sentence Q-187's first four steps deliberately held back: *"then as you input your
actuall food it can recalculate food based on the macros left. I.e if you eat too much during lunch
it will cut some portions for other meals or vice versa."* The gate was opened and answered the same
day — *"Happy to spread or take it out of next meal: would be nice to have the option; but if
choosing one then spread is fine"* — so this is spread, at read time, with a floor.

### What shipped

- **`components/nutrition/plan-rescale.ts`** — `rescaleRemaining` returns the adjusted figures for
  the meals still to come, plus one sentence when the floor binds. `remainingMeals` is the set it
  acts on.
- `plan-meal-row.tsx` renders the adjusted figure with `(planned N)` beside it; `meal-plan-section.tsx`
  computes the re-scale and renders the sentence.

### The entry pointed at the wrong set, and it is the opposite one

Q-187 said `fillableMeals` *"already answers which meals are still ahead of you, which is exactly the
set a re-scale would act on."* It answers which meals are **due enough to log now** — on today it
keeps meals whose hour has already **come** (`hour <= nowHour`), because logging food you have not
eaten is the thing it exists to prevent.

A re-scale wants the complement: what you have **left** to eat, with hour not entering at all. A
lunch you skipped past is still food you might have, and dropping it from the remaining budget would
silently hand its calories to dinner. `remainingMeals` is unlogged-and-undeclined, full stop, and the
guard pins the distinction.

### Decisions

- **Read time, never stored.** The plan stays what the owner chose; deleting the module restores
  today's behaviour exactly. A stored rewrite loses the original plan and would be Lane A's.
- **The floor is per meal, not all-or-nothing.** A meal whose scaled figure falls under 250 kcal is
  left as planned and counted in the sentence; meals that clear it are still adjusted. Printing
  *"eat 180 kcal for dinner"* is what makes a plan ignored once and then always.
- **Macros ride the meal's own factor**, so a meal keeps the split the plan chose for it. Scaling
  each macro against its own remaining budget would let a day that went over on fat alone quietly
  rewrite every meal's shape.
- **The planned figure stays on screen** beside the adjusted one. Replacing it outright would make
  the plan look as though it had changed, and it has not.
- **Four scalar props, not one object.** `PlanMealRow` is `memo`ed and rendered in a `.map()`, where
  a fresh `{ calories, … }` literal defeats the memo silently while the component keeps its wrapper —
  the shape `check-memo-prop-stability.js` exists to catch. `meal-macro-bars.tsx` is the reference.
- **Nothing is logged.** The prefill's property is that nothing enters `food_logs` unconfirmed; this
  changes what is *suggested*. A guard asserts the module contains no `fetch`, `queueMutation`,
  `upsert`, `localStorage` or `setCached`.

### Verification

- `components/nutrition/__tests__/plan-rescale.test.ts` — 16 tests. **Ten mutations kill it:**
  next-meal-only instead of spread, no floor, re-scaling a past day, ignoring declines, macros not
  riding the factor, a `fetch` in the module, the card never calling it, the note not rendered, the
  today gate dropped, and the scalars replaced by one object prop.
- **One of those mutations initially survived and the guard was wrong, not the code.** The wiring
  assertion matched `/rescaleRemaining\(\{/` anywhere in the file, so
  `const rescale = null && rescaleRemaining({…})` passed it — the text is present while the feature
  is dead. Re-anchored on the assignment, which kills both that and deleting the call outright.
- **Driven on the real screen**, because both vitest projects run in `environment: 'node'` and
  nothing renders there. A plan and a logged meal were inserted into the local database and the
  Nutrition tab opened. All three states observed:
  - **900 of 2,000 eaten** → Breakfast **330 (planned 600)**, Lunch **385 (planned 700)**, Dinner
    **385 (planned 700)**. They sum to **1,100**, exactly the remaining budget.
  - **1,900 of 2,000** → nothing adjusted, rows show planned figures, and the card reads *"Only 100
    kcal left, which is under a meal — the remaining meals are left as planned."*
  - **2,400 of 2,000** → *"You're 400 kcal past today's target, so the remaining 3 meals are left as
    planned."*
  The fixtures were removed from the local database afterwards.
- `pnpm check:rules` **Ran 67 of 67**; `tsc --noEmit` and lint clean.

### Not exercised

- **The S25.** Two numbers now share a line that held one, at 412 dp.
- **There is no committed e2e, and the reason is worth recording: `scripts/local-db/seed.sql`
  creates no meal plan and no food logs**, so every plan-card behaviour is unreachable from the
  harness — not just this one. Filed as **LB-51** with the shape that would work without touching
  the seed (which is Lane A's) and with the gotcha that cost the most time here: the expand toggle
  needs `touchscreen.tap()`, because a forced `.click()` leaves `aria-expanded` at `false`. That is
  Q-354 on the Nutrition screen, and it is exactly what `e2e/README.md` records for the water sheet.

### Deliberately not built

The owner's *"would be nice to have the option"* — spread vs next-meal-only as a preference. Q-187
says to file it only once spread has been lived with and found wanting in a specific way, because
that way decides where the control lives and what it defaults to. A preference shipped alongside the
behaviour it toggles has no evidence behind either branch. It is recorded on the entry's `Keep:` line
rather than as a queue item.
