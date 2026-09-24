# LB-139 — getting Nutrition's tab screen back off its ceiling

**Branch:** `fix/lb139-nutrition-content-ceiling` · **Entry:** LB-139 (Lane B) · **Version:** unchanged

## Why

DV-17's six-line fix left `app/nutrition/nutrition-content.tsx` at **exactly 800 of the 800 lines**
`check-component-size` allows. It passed, and the next line anyone added would not — including a
one-line bug fix, which is the worst possible moment to be forced into an extraction. Filed rather
than improvised inside the device-reported defect it came from.

## What moved

Three changes, all pure moves, no behaviour change:

- **`components/nutrition/nutrition-settings-sheet.tsx`** (new) — the Nutrition Settings sheet. It
  was the largest block in the file that owned its own markup rather than wiring up a component that
  already existed, and it was the sole user of `Sheet`/`Switch` and of the `MealTypeManager` dynamic
  import, so all of that went with it.
- **`components/nutrition/meal-plan-sheets.tsx`** (new) — the manage / edit / setup trio and their
  three `dynamic({ ssr: false })` boundaries, which cross unchanged. They are grouped because they
  hand off to each other — Manage's *rebuild* opens Setup and its *edit meals* opens Edit — so which
  one is open is one decision, not three.
- The hand-rolled delete-log confirm dialog → the existing **`ConfirmDialog`** primitive. It was a
  near-exact duplicate: same title/message/two-button shape, differing only in `max-w-sm` and
  `pt-2` vs `mt-2`. This is the smaller half of the line saving and the better half of the change.

`dynamic` is no longer imported by the screen at all.

**800 → 749.** Fifty-one lines of headroom, and the two extracted files are 51 and 61 lines.

## What was deliberately not done

The `FoodLoggerSheet` / `WaterLogSheet` / `QuickEditLogSheet` / `EndOfDayReview` wiring stayed. Those
are already separate components; wrapping them would move about thirty props from one file into
another and reduce no coupling. The entry also named "the plan-related state cluster" as a candidate
— extracting that means a hook, not a component, and it is a real refactor rather than a move, so it
did not belong in the same change as a ceiling fix.

## Verification

- `pnpm build` green — `/nutrition` compiles at 457 kB. `npx tsc --noEmit` clean; lint clean on all
  three files (the one warning on `nutrition-content.tsx:170` predates this branch).
- Full `components/nutrition/__tests__` suite: 37 files, 337 tests, green. The five other test files
  that read `nutrition-content.tsx` as source — including DV-17's own new spec — all still pass, so
  nothing this change moved was something a guard was watching.
- Four existing nutrition e2e specs against `pnpm dev`: **11 passed**, including the one that
  opens a sheet on this screen.
- Two throwaway Playwright probes (run, not committed — a pure move does not earn a permanent
  spec) drove the extracted surfaces in a real browser: the **settings sheet** opens with its
  reminder switch and Meal Types section, and the **delete-log confirm** now renders as the
  shared `ConfirmDialog` with its message and a Cancel that closes without deleting the row.
- `pnpm check:rules`: **Ran 77 of 77**, all passed. `check-component-size`: no file over 800 beyond
  the four recorded hotspots.

## What verifying it turned up

The third probe — the meal-plan **setup** sheet — never opened, and **it fails identically on
`origin/main`** with the refactor stashed out, so it is not this change. Filed as **LB-140**, at the
top of Lane B. The short version: no console error, no failed chunk, nothing in the tree 20 s after
the tap, and the only asymmetry is that the two overlays that DO open are statically imported while
this one is `dynamic({ ssr: false })` — the exact shape LB-129 measured and fixed for
`EndOfDayReview`. It is unverified outside the dev server, which is the entry's first action.

**Not exercised:** the APK. This is a WebView-delivered JS change with no native surface, but the
sheets themselves open from touch on the device and nothing here was opened on one. Samsung WebView
rendering, safe-area insets and drifted production data were not tested. A production build was not
exercised either: `pnpm build` is green, but `next start` will not come up in this container
(`routesManifest.dataRoutes is not iterable`), so every browser result above is the dev server.
