# 2026-08-26 — a recipe screenshot has nowhere to go, and almost everything for it exists

**Branch:** `feat/recipe-image-intake` · docs-only · BugFix Intake

## The request

*"id like to be able to upload an image like above to the meal creator and have it make it - i see we
dont have that upload option yet."* — with a screenshot of a Google recipe overview.

## Where the meal creator actually is

The BF-11 chain is mostly shipped. **BF-11b, c, d, e, f and g** are all out of the queue with journal
entries — the scan returning N candidates, recipe-URL import, duplicate detection on save, meal-type
tags, tagging from Build a Meal, and the planner searching the library before asking the AI.

What is left: **BF-11h** (the wizard rendering what BF-11g's engine already returns — `source`,
`matchReason`, `libraryMatchCount`, `droppedPins`; and **nothing sets `useLibrary` yet**, so the
library search is off for every real request until that entry turns it on), **Q-407** (the wizard's
seven screens for six answers), and **BF-11** itself as the spec and final checkpoint.

## The finding: this is smaller than it looks

BF-11c shipped recipe import — the builder's search field detects a URL and `importRecipe()` POSTs
`{ url }` to `/api/nutrition/scan`, which returns `ingredients[]` and `candidates[]`, mints a
`food_item` per ingredient, and hands them to the builder.

**That same route already accepts `{ image, mimeType }`,** and both branches share one `ScanSchema`
that already carries `ingredients[]` and `candidates[]`. The plumbing exists end to end. Two things
are missing:

1. **The image branch's per-request prompt says `'Analyse this food photo'`** — which, handed a
   screenshot of an ingredient list, instructs the model to estimate a finished plate instead of
   reading the list. The *system* prompt above it already understands recipes and multi-dish pages.
2. **No affordance** in the builder to hand it an image.

## Why the URL path doesn't already cover it

The owner's screenshot is a **Google AI overview**, not a recipe site. The ingredients are rendered
into Google's own results page with the source behind a `YouTube · MOMables` chip — **there is no
recipe URL to paste.** The image is the only handle on that content, which is precisely the case the
URL path cannot serve.

## The trap, already paid for once

`importRecipe()` carries the comment: `recipeYield` *"is handed straight up rather than defaulted to
1 … a banana-bread page measured 1,956 kcal for the loaf. Deciding here that it is one portion is
exactly the four-fold calorie error that reads as plausible."*

The URL branch gets the yield from the page's JSON-LD. **A screenshot has none**, so it can only come
from the model reading it off the image or from the builder's batch-size field. Null is the correct
answer and the builder already asks. The entry says never to default it.

## One design line worth holding

*Photograph your dinner* and *screenshot a recipe* are different acts with different outputs — a
logged food versus a saved meal. One tile that guesses which was meant will guess wrong. The owner
said *"the meal creator"*, so this belongs in the builder beside the URL path, not on Log Food.
