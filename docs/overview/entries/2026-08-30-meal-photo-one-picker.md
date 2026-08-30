# One photo picker per screen, and the held rebuild's failure explained (BF-46 ①a)

**Branch:** `feat/meal-photo-one-picker` · **Lane B**

Owner: *"Yes I found the photo picker; its in two locations; once at the top of the page and once at
the bottom. I only want the one at the top."* Two things said *Add a photo* and **only one of them
was a picker**: the meal's own screen called `onEdit`, dropping you into the builder to find a 64 px
tile below `Add ingredient` at the bottom of a scroll.

## What shipped

Both are real pickers now, each at the top of its own screen, at the size the artboard gives a
meal's photo. The meal's own screen writes through the parent's `saveMealToLibrary` — the same
function the builder calls — so there is **one write path** to `image_data_uri`, which is what the
old comment there argued for and achieved by having no picker at all.

`MealPhotoTile` grew a `variant="hero"` rather than a `MealPhotoHero` being built beside it. That is
the load-bearing choice: the previous attempt built the separate component *with its own acquisition
hook* and could not make a picked image reach it, while this component's `<input>` path is what
`meal-photo-picker.spec.ts` has exercised on every run since Q-327. Growing a size is a smaller
change than growing a second implementation.

## The held rebuild's failure, explained

Rebuilt, the same failure reproduced exactly: `handleFile` fires with the file, `accept` runs with a
valid 4,247-character data URI and `reject=null`, `onChange` is called — and the builder's state
never moves.

**Instrumenting the parent settled it in one run.** A log on the builder's `onChange` prop *never
fired*, while the tile's own "calling onChange" did. So the tile that received the file was **the
other instance** — the meal's own screen, which is still in the DOM while it closes. Both pickers
carried the same accessible name, and the spec waited for that name before picking. It was already
satisfied by the screen it was leaving.

*A precondition satisfied by the state it is meant to replace cannot fail.* That is the third time
this shape has cost real time in a day — the meal-label ink gate, this file's `Ingredients` marker,
and now this. The spec waits for `Update Meal`, which exists only in the builder.

**So the app was right and the harness was wrong**, and the previous session's conclusion —
"the picture reaches nothing" — was a true observation with the wrong subject. Worth stating plainly
because that entry told the next person to start from the instrumentation rather than the layout,
and the instrumentation was measuring the wrong component.

## Verification

`e2e/meal-photo-picker.spec.ts`, now three tests. The two that existed still pass unchanged in
substance — a photo-sized JPEG is downscaled below `SAVED_MEAL_IMAGE_MAX_BYTES`, stored as WebP, and
a save that never touches the tile keeps it. The new one picks from **the meal's own screen** and
asserts the stored row, which is the affordance that was fake. **Proved both ways:** point that
hero's `onChange` back at `onEdit` and it fails.

Its readiness gate is `Log this meal`, which exists only on that screen — the same discipline the
first test now uses, and for the same reason.

Full unit suite **5,640 passed** / 672 files. `pnpm check:rules` — **Ran 62 of 62**. Typecheck and
lint clean.

## Not exercised

- **The device.** Nothing here is native — the acquisition path is unchanged, and BF-46 ①(b)'s CSP
  fix (v1.400.0) is what makes the *native* branch work at all. But no photo was picked on the S25,
  and BF-46's `Keep:` is that check.
- **A meal saved while offline.** `setMealPhoto` takes `saveMealToLibrary`'s local-first branch like
  every other meal write, but the sandbox has no local store, so the web fallback ran every time.
- **Two pickers genuinely co-visible.** They are on different screens and one closes as the other
  opens; what was measured is that both are briefly *mounted*, not that both are ever usable.
