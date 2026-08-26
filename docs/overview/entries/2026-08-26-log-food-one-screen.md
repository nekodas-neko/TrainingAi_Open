# 2026-08-26 — Log Food became one screen, and the list it holds became two

**Branch:** `feat/log-food-one-screen` · **Entries:** LB-16, BF-37 · Implementation Lane B

Two entries that had to ship together. LB-16 collapses the Log Food capture step onto one screen;
BF-37, filed the same morning from an owner report, un-merges the list that screen shows. They touch
the same file, the same tab strip and the same device pass, so building them apart would have meant
cutting the same screen twice.

## LB-16 — five tiles become an action row

The capture step asked **"How would you like to log food?"** and offered five tiles — `Scan Photo`,
`Barcode`, `Describe it`, `Manual Entry`, `My Foods` — before showing any food at all. The list is
the screen now, with `Photo · Barcode · Describe or enter` as an action row above it.

**Describe and manual entry are one panel.** They were two tiles leading to two screens, and which
one you want is not a decision anyone can make *before* seeing the fields. The decided action row
called the pair `Describe or enter` for exactly that reason; the panel now shows the description box
and an explicit way into the manual form together.

### The structuring decision, and where the recorded recommendation was incomplete

The entry offered three shapes and starred the third — *invert: put the capture screen inside
`SavedMealsSheet`*, on the grounds that nothing has to move. That is right, and it understated one
thing: `SavedMealsSheet` is **stacked on** `FoodLoggerSheet`, so putting the capture screen inside it
would have left the logger rendering an empty sheet behind the list — a second scrim and a wasted
back press, on the entry whose title is *six entry points become one*.

So the inversion shipped with one addition: **`FoodLoggerSheet` renders no sheet of its own at the
capture step.** `open && step !== 'capture'` on its own `<Sheet>`, `open && step === 'capture'` on
the list. One screen is one sheet is one back-stack layer.

## BF-37 — the merged list, un-merged

Owner, on v1.382.0: *"my foods combined saved meals + history thats not right they are 2 seperate
things."*

The BugFix entry makes the distinction worth repeating: the question that produced the merge —
*"whats the difference"* — was read as *one list wearing two names*, and it says something narrower.
Two lists that could not be told apart. The fix was to name them so the difference is obvious.

**They are two tabs of one screen, not two sheets.** That is the shape the entry lists first and it
is the one the collapse above makes available: the strip does the telling-apart that two separately
reached surfaces never could, because you can see both names at once.

`Recent` · `Meals` · `Single foods`.

- **The labels drop the possessive deliberately.** `My Foods` against `My Meals` is the pair the
  owner could not tell apart, and two labels differing only in their last word are hard to tell
  apart wherever they appear. `Meals` against `Single foods` names the actual distinction — a
  composition against one thing.
- **`food-list.tsx` was not rewritten**, per the entry: the separation already existed inside it (a
  food row opens the assign step, a meal row opens its own screen). It gained one `show` prop.
- **The page's library button is `My Meals` now** and lands on the Meals tab, so its name matches
  where it goes. Every *save-to-library* string followed it back — 13 occurrences across five files,
  all of which are about saved meals specifically.

## `Recent` reads a meal bucket, and that is a data limit rather than a design choice

There is no unfiltered "recent food items" query on either side: the route is
`recent-for-meal?mealTypeId=…` and the local store is `getRecentFoodItemsForMeal`. Adding one touches
`app/api/**` and `lib/local-store/**` — **Lane A's**, not this lane's.

So the parent resolves a bucket (the preselected one, else `mealTypeForHour`) and the panel reads
that. It is defensible rather than merely tolerable: opening Log Food at 7 pm and being shown what
you usually eat at dinner beats a global list topped by breakfast coffee. If use says otherwise, the
swap is one fetch. **Filed as LB-18** so the option is on the record rather than in a comment.

## What this cost, stated rather than buried

**The nutrition back-dismiss nest is two layers now, not three.** `Add food` → logger → `My Foods`
tile → list → meal was three; `Add food` → list → meal is two. That is what collapsing the screen
was *for*, but it means `back-dismiss-sweep.spec.ts` no longer has a three-deep path to assert on,
and its two nest tests became one.

The three-deep case LB-17 was written for is asserted directly, without a browser, in
`lib/hooks/__tests__/sheet-back-stack.test.ts` — seven cases including the sibling swap and the
StrictMode double-mount, none of which a coordinate tap reached reliably. The surviving e2e test
gained a new assertion in exchange: **a tab switch pushes no history entry.** If it ever did, back
would spend presses on tabs and the unwind would stop matching what the user sees.

## Verification

- `npx tsc --noEmit` clean · lint clean on `components/nutrition`
- `pnpm check:rules` — **Ran 59 of 59**, all passed (one fix: `module-map.md` still named the deleted
  `capture-step.tsx` as the meal-label scan branch)
- `check-component-size` — nothing over 800 beyond the four recorded hotspots;
  `saved-meals-sheet.tsx` is 737
- Unit suite — **5,065 passed / 57 skipped**, unchanged
- Full Playwright suite run locally against the new screen

### Failure surfaces NOT exercised

- **The S25.** Every part of this is layout and gesture: a new tab strip, a rebuilt action row, and
  one fewer sheet in the back stack. `Gate: device`, written into
  [`device-verification-queue.md`](../../device-verification-queue.md) — it **replaces** N2's
  three-press check, which is now a two-press check, and rewrites N4 around the split.
- **The native local store.** `getRecentFoodItemsForMeal` returns null in the web sandbox, so the
  `Recent` tab's local-first branch is only exercised on the device.
- **The camera.** `handleCapturePhoto`'s native branch moved file-to-file unchanged; the web branch
  (a hidden file input) is what runs here.
