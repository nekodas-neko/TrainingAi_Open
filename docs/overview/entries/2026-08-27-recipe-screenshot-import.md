# 2026-08-27 — `feat/recipe-screenshot-import` (BF-40) — a recipe from a picture, and the prompt that assumed a plate

**Lane B · v1.390.0 · one entry shipped (BF-40).** Includes one prompt line in
`app/api/nutrition/scan/route.ts` — Lane A by path, trivial by size, and the entry pre-authorised
taking it in the same PR.

Owner, with a screenshot of a Google recipe overview: *"id like to be able to upload an image like
above to the meal creator and have it make it — i see we dont have that upload option yet."*

## Most of it was already built

BF-11c shipped recipe import, `/api/nutrition/scan` already accepted `{ image, mimeType }`, and both
branches already shared one `ScanSchema` carrying `ingredients[]` and `candidates[]`. Two things were
missing: the image branch's prompt said *"Analyse this food photo"* — which, handed a screenshot of a
word list, instructs the model to estimate a finished **plate** rather than read the **list** — and
the builder had no way to hand it an image at all.

**Why the URL path could not already cover it.** The owner's screenshot is a Google AI overview: the
ingredients are rendered into Google's own results page with the source behind a `YouTube · MOMables`
chip. There is no recipe URL to paste, so the image is the only handle on that content.

## The yield trap was already handled, which is the finding worth recording

The entry's ⚠ is a documented four-fold calorie error: a screenshot has no JSON-LD, so nothing can
read a yield off it, and defaulting to one portion turns a loaf into a slice plausibly enough that
nobody notices.

**Reading the route showed it is structurally safe already.** `recipeYield` initialises to `null`
(route.ts:157) and is only ever set from JSON-LD in the URL branch, so an image returns
`recipeYield: null` and `servings` stays 1 — meaning **no divide**. The whole-batch figures reach the
client, `recipeBuilderPatch` sets `unstatedYield: true`, and BF-11c's amber *"that page didn't say
how many this serves"* prompt fires. `ScanSchema` has no yield field and this entry deliberately did
not add one: a model-reported yield is a hallucination risk that would divide silently, and the
builder already asks.

So the danger was never the route defaulting to 1. It is someone building a **second** import path
that does — which is why `importRecipeFrom(...)` is now shared rather than copied.

## The regression that mattered more than the feature

One prompt line served both acts. Changing it wholesale would have made the photo scan read dinner as
a recipe — silently, and plausibly.

`packages/shared/src/nutrition/scan-prompt.ts` makes the choice a tested pure function, the same
shape BF-11c used for `recipeBuilderPatch` and for the same reason: both prompts are correct in
isolation and getting the choice wrong fails without an error. **Absent means `'plate'`**, and the
plate strings are reproduced **verbatim, note-case included** — an earlier draft of this change
reordered the with-note variant, which would have made "byte-identical for existing callers"
approximately true rather than true. Two tests pin the literals.

The photo path is otherwise **provably untouched**: its only diff is importing `SCAN_IMAGE_MAX_DIM`
rather than declaring it, and it sends no `imageKind`.

## Two smaller decisions

- **The affordance shows only on an EMPTY search.** A typed query means the estimate row, a pasted
  link means the import row; a permanent third button would crowd the one control that matters on
  that screen.
- **No `capture` attribute, `CameraSource.Prompt` on device.** `capture="environment"` forces the
  camera, and a screenshot lives in the gallery — it would have made the owner's own example
  unreachable. Prompt covers both readings of "an image of ingredients": a written list, and the raw
  ingredients laid out.

## Verification

- 8 unit tests on the prompt decision, including the two verbatim plate pins.
- `e2e/recipe-image-to-meal.spec.ts`: a picture becomes ingredients at their own weights, the request
  carries `imageKind: 'recipe'`, **and the builder asks how many it serves** rather than assuming.
  Plus that the affordance yields to both a typed query and a pasted link.
- `pnpm check:rules` — Ran 61 of 61. Full vitest and full Playwright.

## The full suite caught a defect in this PR's own spec

`recipe-image-to-meal.spec.ts` passed 4 of 4 alone and then **failed in the full run** — a
strict-mode violation, two `Spec Flour` elements. The accessible names identified them: one was the
ingredient row (`Spec Flour 2.5 servings · 250 g`), the other a search-result row
(`Spec Flour 10g P per 100 g`).

The import mints a real `food_item` per ingredient and the spec never cleaned up, so from the
**second** local run onward its own leavings reappeared in the picker's list and the bare-name
assertion matched both. It passed alone because that was the first run — and **CI provisions a fresh
database every time, so CI would have stayed green indefinitely** while every local run after the
first failed. That is the inverse of the aged-fixture trap `CLAUDE.md` documents, and it hides just
as well.

Fixed on both sides rather than only the visible one: `beforeAll`/`afterAll` cleanup so the spec
stops accumulating rows in the shared local database, and assertions matched to the ingredient row's
own shape rather than a name anything can carry. Verified by three consecutive solo runs — run 2 is
where it previously broke — with zero residue left in `food_items` afterwards. The rule is now in
`e2e/README.md`, including the cheap habit that would have caught it: **run a new spec twice before
believing it.**

**A subset run would have shipped this.** It is the second time tonight the full suite has earned
its fifteen minutes.

## Not exercised

**The model's actual reading of an image.** The e2e stubs `/api/nutrition/scan`, because a live run
costs a model call per run and is non-deterministic — so this proves everything downstream of the
response and nothing about the prompt working. The owner's own screenshot end to end is the check
that is still owed, and it needs a real call.

**The APK**, where the native `Camera.getPhoto` branch lives. The web path uses the file input; the
Capacitor branch is unverified, and it is the one the owner will actually use.
