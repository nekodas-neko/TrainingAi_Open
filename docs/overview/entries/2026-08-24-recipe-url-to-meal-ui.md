# 2026-08-24 — a recipe link becomes a meal, and an unstated yield gets asked about (Q-409, Lane B half)

**PR:** `feat/recipe-url-to-meal` · **Lane B**

## What shipped

The "meals you usually eat" step of the meal-plan wizard takes a URL. A URL is a **third input mode
beside image and text, resolving to the same shape**, so the widget, the `keep` semantics and the
downstream plan payload needed no change — which is why this is a few lines rather than a subsystem.

- `components/nutrition/my-meals-picker.tsx` — detect an `https:` URL, send `{ url }` instead of
  `{ text }`, show the source host, and ask how many the recipe serves when the page did not say.
- `packages/shared/src/nutrition/scan-totals.ts` — `perServing(ingredients, servings)`.
- `app/api/nutrition/scan/route.ts` — now calls that helper instead of its own inline map.

The route half (the `https:`-only guard, the SSRF checks, the JSON-LD parse, the divide on a stated
yield) shipped in PR #180 and is untouched here.

## The part that is not cosmetic

**`recipeYield: null` means the payload is the whole recipe.** With a stated yield the route has
already divided and its notes lead with *"Per serving (1 of 12)"*. Without one, a banana-bread page
measured **1,956 kcal for the loaf**. The entry's rule is *ask, do not assume 1*, so the row:

- shows the whole-recipe figures with the question **"How many does it serve?"**,
- **cannot be kept** until it is answered — keeping it would put a loaf in one meal slot,
- divides on the answer, and flips to kept in the same act, because answering the question **is**
  accepting the meal and asking twice for one decision is worse.

`perServing` is shared rather than copied: the route divides on a stated yield and the picker divides
on an answered one, and a 4× calorie error that looks entirely plausible is exactly the kind that has
to agree by construction.

## Verification

`e2e/recipe-url-to-meal.spec.ts`, two cases. The first asserts the picker sent the link as `url`
(not as free text), that the ask appears, that Keep is absent before it is answered, and that the
answer divides. The second is the mutation the first cannot catch: a **stated** yield must not be
divided a second time — that bug would read as a light meal rather than as an error.

Plus three unit cases on `perServing` itself, including that the per-100g densities are left alone;
scaling those too is the other way to divide twice.

**Mutation-checked twice.** Dropping the divide in `applyServes` fails the first spec. And the first
draft's "Keep is absent" assertion used `/^Keep$/`, which never matches: the button's accessible name
comes from the `<label>` wrapping it, so the guard passed and would have passed just as happily with
the control on screen. It asserts on the real name now.

**The scan route is stubbed in the spec, deliberately** — what is under test is the picker's handling
of a payload shape, and the alternative is CI fetching somebody's recipe site on every run. So this
proves nothing about the fetch, the SSRF guards or the JSON-LD parse; those are the route's own.

Full local gate: 53 of 53 Custom Rules, lint clean, both specs and the unit tests green.

**Not exercised:** a real recipe page, and the device. Nothing here is native, but the wizard's
scroll and tap targets on the S25 are unverified as always.
