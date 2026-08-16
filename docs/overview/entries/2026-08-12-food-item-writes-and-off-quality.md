# 2026-08-12 — One offline-first way to create a food, and a warning on food-database rows

**Release:** v1.293.0 · **Domain:** nutrition · **Branch:** `fix/food-item-writes-and-off-quality`
**Closes:** Q-197, Q-199, Q-196 — all three found by the post-merge review of v1.290.0, not by a user report.

## Q-197 — three creation paths, none of them offline-first

The meal builder created a `food_item` three ways — by hand, from an Open Food Facts hit, and from
the AI estimate — and all three were a bare `POST /api/nutrition/food-items` whose response went
into React state. Three gaps at once:

- **Nothing reached the local store.** A comment above `addExternalFood` claimed the item "lands in
  the user's own library and is searchable locally (and offline) from then on". It did not, until
  the next sync pull — and the local-first `store.searchFoodItems()` in the same file could not
  find it.
- **No outbox mutation**, so creating a food offline was impossible rather than merely slower.
- **No cache invalidation.** `nutrition-food-items-all` is seeded by `food-library-sheet.tsx` at
  `TTL_MEDIUM` and only the food-*log* group cleared it, which none of these writes touch. A food
  you had just created was missing from the Food Library sheet.

All three now go through one `createFoodItem()`
(`packages/shared/src/nutrition/create-food-item.ts`), which is `logFoodEntries`' existing shape
extracted rather than a fourth invention: mint the id on the client, write locally, queue the
`food_items` mutation, invalidate, push. Plus a new `invalidateFoodItems()` cache group.

**The sanitiser runs client-side there on purpose.** The route applies `sanitiseNutrition`
server-side, so a client storing its own unsanitised copy would hold different numbers from the
server for the same id until the next pull. Running the same shared function first makes them agree
by construction.

Adding a food by hand no longer needs a connection, so its explicit offline guard went away; the
OFF and AI paths still need one by nature and now say so in the same words instead of a generic
"could not add".

## Q-199 — a searched product was recorded as a scanned one

`addExternalFood` wrote `source: 'barcode'`. A barcode identifies one exact product; a name search
returns a plausible near-match picked off a list. `'text'` was already in the enum
(`'ai' | 'barcode' | 'manual' | 'text'`) and **had never been written by anything**, so this needed
no migration — it just needed using.

## Q-196 — a food-database row's macros need not match its own calories

OFF entries are filled in field by field by different contributors. Measured on a live search:
**Chobani Greek Yogurt Blueberry, 123 kcal stated, 164 kcal by Atwater — 33% out.** That sits under
`sanitiseNutrition`'s 40% rewrite threshold, so the row lands exactly as given and the user picks it
off a list believing both numbers.

`macroCalorieDisagreement()` now lives beside the sanitiser in `scan-totals.ts`, sharing its
constants: `ATWATER_DEVIATION_LIMIT` (0.4, rewrite) and `MACRO_MISMATCH_VISIBLE_LIMIT` (0.15, warn).
**Warn strictly before rewrite** — a test asserts the ordering, because the alternative is a row the
UI calls fine while the sanitiser silently rewrites it, or the reverse. Below 15% is ordinary
rounding (labels round, Atwater factors are approximations) and warning there would train people to
ignore the warning.

The row is kept and flagged, never dropped: OFF's coverage is the point of the feature.

## Verification

`tsc` clean · 0 lint errors · 17/17 custom checks · **451 files / 3,718 tests green** (7 new).

Measured against live OFF through `pnpm dev`: a `greek yogurt` search returned 20 rows, **4 flagged**
— including the blueberry one above — while Chobani's plain Greek Yogurt (90 kcal vs 84 by Atwater,
6.6%) correctly was not. That discrimination is the whole point of the tighter threshold.

One near-miss worth recording: the first version of `createFoodItem` bucketed its outbox mutation
with `new Date().toISOString().slice(0, 10)` — the exact UTC-date pattern CLAUDE.md bans, which is
yesterday in Brisbane until 10am. Caught and changed to `todayInTz()` before commit.

## Not exercised

- **Not verified on device.** The whole point of Q-197 is the local-store and outbox path, and
  native SQLite does not exist in the sandbox — so the branch that now matters most is the one that
  has never run. The web fallback (which is what was tested) is the *other* branch.
- Creating a food while genuinely offline, and its later push, are APK-only.
- No migration, no schema change.
