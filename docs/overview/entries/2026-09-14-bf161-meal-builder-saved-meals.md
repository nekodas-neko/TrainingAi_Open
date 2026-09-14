# 2026-09-14 — BF-161: the meal builder cannot see your meals (BugFix intake)

Docs-only. Owner: *"For the meal builder it should let you add meals/saved items as part of the meal
builder."*

## Three ingredient sources, none of them a meal

`ingredient-search.tsx` names them in its own header — the user's own **foods**, the **AI estimate**,
and the **food database** (Open Food Facts). `saved_meals` is absent, and the placeholder says so
out loud: *"Search your foods or the food database…"*.

`food-list.tsx` already carries a `meals` tab, so **Log Food** can log a saved meal in one tap. The
builder, one screen deeper in the same sheet, cannot reach them. The capability exists; it does not
reach here.

## The schema is the interesting part

```ts
savedMealItems: { savedMealId → savedMeals, foodItemId → foodItems (NOT NULL), quantityMultiplier }
```

A meal item **is** a food item. There is no column a nested meal could occupy, so this is not a UI
oversight that a dropdown fixes — it is a design question about what "a meal inside a meal" means.

## The recommendation, and what it costs

**Flatten on add.** Picking a saved meal expands its items into the builder as ordinary ingredients
with their multipliers. No migration, no recursion, Lane B alone. Measured on his account: **15 saved
meals averaging 1.9 items** against **304 foods** — the ingredient lists stay short, so the obvious
objection does not bite at his scale.

**What it gives up, stated rather than glossed:** no link back. Editing the source meal later will
not change a meal built from it. Arguably right — a built meal is a recipe you fixed, not a live
reference — but it is a real difference and the owner decides.

The alternative is a nullable `food_item_id` plus `nested_saved_meal_id`: real composition, edits
propagate, and it costs a migration, recursive macro computation in **every** consumer of
`saved_meal_items`, and cycle prevention (A contains B contains A). Not worth it for 15 meals of 1.9
items unless propagation is specifically wanted.

Filed `Gate: owner` — flatten versus nest is a product decision, and a one-line answer unblocks it.

## Not exercised

Docs only. The three sources were read from the component's own documentation, the constraint from
the Drizzle schema, and the counts from production.
