# Meal Creator & Meal Planner — design

**Status:** Design, agreed with the owner. **Not a plan, not implemented.** Written to be handed to
a planning session to scope and turn into implementation plan(s), per `docs/implementation-backlog.md`'s
backlog-driven protocol. Filed from **BF-11**, which carries the trace against current code; this
doc carries the decisions.

**Date:** 2026-08-24

---

## Why this exists

BF-11 started as "the recipe-URL scan is in the wrong place" and grew, across three owner messages
in one session, into a full redesign of how meals get created and how a day's meal plan gets
assembled from them. This doc is the settled shape from that conversation — what's confirmed
already built, what's a real gap, and what's still an open call for the planning session.

---

## Part 1 — Meal Creator ("Build a Meal", `saved-meals-sheet.tsx`)

### Already built — do not re-design these

- **Per-ingredient quantity adjustment** (servings or grams, ± stepping) — `saved-meals-sheet.tsx`.
- **Manual food-database search** (own library + Open Food Facts) — `estimateAndAdd`/`addExternalFood`.
- **Serving-size concept** (a meal's `servings`, `totals` divided per serving) — already the shape
  of `SavedMeal` (`packages/shared/src/types/nutrition.ts`).
- **Single-item AI text estimate** — `estimateAndAdd` posts `{ text }` to `/api/nutrition/scan`.
- **Single-item AI image estimate** — same route, `{ image, mimeType }`, JPEG/PNG/WebP.

### Real gaps to build

1. **Recipe URL / whole-recipe scan does not exist in Build a Meal.** It exists only inside the
   meal-plan wizard's Meals step (`my-meals-picker.tsx`) — this is BF-11's original finding. Move or
   duplicate the `{ url }` scan mode into Build a Meal as a first-class add method.
2. **Multi-item detection.** `ScanSchema` (`app/api/nutrition/scan/route.ts`) returns exactly one
   `name` + `ingredients[]`, for every input mode. A photo or page showing several distinct dishes
   (a week's meal-prep containers, a "5 lunches" recipe roundup) needs to come back as **N
   candidate meals**, not one merged/wrong estimate. Schema, prompt and the picker UI (which
   currently assumes one result per scan call) all need to handle an array — the user then picks
   which of the N to actually save, and can adjust each individually before saving (same as any
   other add path).
3. **No "recent/previously used foods" quick-add inside Build a Meal.** Confirmed: this **does**
   exist elsewhere in the app — Log Food's capture step has a **History** action (`capture-step.tsx`,
   `onMyFoods`) surfacing previously-used food items. The gap is narrower than first stated: Build a
   Meal's own ingredient picker doesn't reuse that same list — it's type-to-search only. **Reuse the
   existing History data source rather than building a new one** — this is a UI wiring gap, not a new
   data model.
4. **PDF upload — descoped.** Owner: screenshot the PDF and upload as an image instead. No PDF
   MIME support needed in the scan route. Removes an open question, not a gap.
5. **Duplicate detection on scan.** When a scan (URL, image or multi-item) produces something close
   to an existing saved meal (name match, close macros), ask **"you already have something like
   this — update it or save as new?"** rather than silently growing the library. Owner: *"happy to
   have this workflow for now"* — confirmed, build it as stated, refine later if it's too aggressive
   or too loose in practice.

---

## Part 2 — Meal Planner (wizard + `generate/route.ts`)

### Already built — do not re-design these

- **The wizard's step shape** (Stores → Avoid → Skip → Meals → Yours → Training → Review) — owner's
  description of the flow matches this almost exactly. Keep the stepper.
- **Per-meal regenerate ("reroll")** — `meal-plan-review-step.tsx`, a button per meal that calls
  `/api/nutrition/meal-plans/generate/meal` for a fresh AI suggestion targeting that meal's slot.
- **Per-meal AI-edit-in-place ("change something about it")** — same screen, a free-text instruction
  box ("make it vegetarian", "swap the rice for potato") that rewrites the meal keeping everything
  else. Same route, `instruction` + `currentMeal` in the body.
- **Serving-size / top-up scaling for a kept meal** — `scaleWithTopUp` (`lib/nutrition/meal-top-up.ts`)
  already adjusts a meal's portions, and adds filler food, to hit a target's macros. This is the
  mechanism Part 2's "library first" design (below) needs — it doesn't need to be built new, it
  needs to run against more candidates than just explicitly-pinned meals.

### Real gaps and design decisions

6. **"Prefer my saved meals, top up with AI" is a real reordering of the generation logic —
   confirmed as the core piece of this redesign.** Today: `generate/route.ts` splits the day's
   macros into N slots **before** any meal selection, and every slot that isn't an explicitly-kept
   meal is generated fresh by AI — nothing searches the saved-meal library for a fit. The new
   order: **for each slot, search the saved-meal library for a macro-fitting candidate first;** if
   found, use it (adjusting serving size via `scaleWithTopUp`, same as today); only fall back to AI
   generation for a slot with no reasonable library match.
7. **"Select all my saved meals" needs the 6-meal cap lifted or redesigned.**
   `keepSavedMealIds` is capped at 6 in `RequestSchema` (`generate/route.ts`). A true "use my whole
   library first" flow needs the route to consider an arbitrarily-sized library as *candidates to
   search*, not a capped list of *meals to force-include* — these are different mechanisms. The
   existing checkbox-per-meal picker (today's `selectedIds`) stays as the explicit-pin path; "select
   all" becomes "consider my whole library as candidates," not "force-include every meal I own,"
   since a library of 20 meals cannot all fit into a 3-meal day.
8. **Meal tags/categories — confirmed as a real, necessary gap.** Owner: *"we don't want pancakes
   recommended for dinner... a tagging system to flag which meal it would/could be had at."*
   Without this, macro-fit alone will make nonsensical picks. **Recommend reusing `MealType`**
   (`packages/shared/src/types/nutrition.ts` — the user's own named, configurable meal types:
   Breakfast/Lunch/Dinner/etc., each with a time window already) as the tag vocabulary, via a new
   many-to-many join between `SavedMeal` and `MealType` (a meal can be eligible for more than one —
   a protein shake might be tagged both Breakfast and Post-Workout). This avoids inventing a second,
   parallel "meal category" concept when the app already has user-defined meal types with the right
   shape. **Needs a migration** — SavedMeal carries no type/tag field today. BugFix does not claim
   migration numbers; this is Lane A's to number when planned (per `docs/agents/README.md` §3).
9. **No-library-match fallback — flagged as open, owner agrees it's a gap.** When no saved meal
   fits a slot within a reasonable tolerance, two options were raised and NOT decided between:
   (a) prompt the user to go create/scan a new meal for that gap, or (b) fall through to AI
   generation as today, presenting it as a suggestion. Planning session should decide, possibly per
   user preference or as a setting — not resolved here.
10. **"Why this meal" note on library-matched slots — confirmed, ties into reroll/edit.** When the
    planner picks a library meal for a slot, show a short reason ("picked to hit your protein
    target"). Owner: *"it will help if you regenerate or want to type to the AI to change the
    meal"* — i.e. this isn't just cosmetic, it's context the reroll/edit UI should carry forward
    (e.g. an AI edit instruction knows *why* the meal was picked, so "change something about it"
    doesn't undo the reason it was chosen).
11. **Reroll should offer "swap in a different saved meal," not just "ask AI again."** Today's
    reroll (`askForMeal` in `meal-plan-review-step.tsx`) always calls the AI. Once the planner is
    library-aware (item 6), reroll's natural extension is: show other library candidates for that
    slot first, AI-generate as a secondary option — mirroring the creator-side "prefer library, AI
    as filler" principle.
12. **Meal-count change needs a redistribute prompt, mirroring an existing pattern —
    but it is not the same mechanism.** Owner: *"When I chose to remove 'pre workout' meal type,
    it asked where those meals would go... if you want to change how many meals, it's gotta prompt
    you somewhere."* The existing precedent is `MealTypeReassignDialog`
    (`components/nutrition/meal-type-reassign-dialog.tsx`, Q-326) — but that dialog reassigns
    **already-logged history** to another `MealType` via a server transaction. Reducing the wizard's
    `mealCount` operates on an **in-progress draft plan**, not logged history — there's nothing to
    reassign in the database sense, only a redistribution of which slot's calories/kept-meal
    absorbs the dropped one. **Treat this as a new, lighter interaction inspired by the same UX
    principle** (never silently drop something the user chose without asking), not a reuse of the
    reassign dialog's mechanism. Needs its own design: if slots already hold picked/kept meals when
    the count drops, which one(s) get asked about, and does "transfer" mean merge calories into a
    remaining slot, or just re-run the split and let the user re-pick.

---

## What's still open for the planning session

- Item 9 (no-match fallback: prompt-to-create vs AI-fallback) — explicitly undecided.
- Item 12's exact interaction (which slot(s) get asked about, what "transfer" produces) — principle
  agreed, mechanism not designed.
- Item 7's exact semantics for "select all" against a very large library (candidate pool vs. some
  other cap) — direction agreed, upper bound not set.
- Sequencing: owner's stated priority is **Part 1 (Meal Creator) first**, Part 2 (Planner
  integration) after. Items 1–5 should be scoped/shipped before items 6–12 depend on them existing.
