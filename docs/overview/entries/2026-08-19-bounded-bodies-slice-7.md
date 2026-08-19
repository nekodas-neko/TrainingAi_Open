# 2026-08-19 — Q-322 slice 7: the nutrition CRUD routes

**PR #205** · branch `fix/bounded-bodies-slice-7` · Implementation Lane A · JS/server only.

Fourteen route files, sixteen read sites — the whole nutrition CRUD surface: food items, saved meals,
meal types, meal plans and their structure, targets, dietary restrictions, plan-meal answers and the
two nutrition-goal routes.

| route | cap | derivation |
|---|---|---|
| `meal-plans` POST, `meal-plans/[id]` PATCH | 2 MB | a whole plan — below |
| `meal-plans/meals/[mealId]` | 256 KB | one meal with its ingredient snapshot |
| `saved-meals` POST + `[id]` PUT | 32 KB | 100 items of a uuid and a multiplier ≈ 6 KB |
| `meal-plans/[id]/structure` | 32 KB | meal counts and a reorder |
| `dietary-restrictions` | 16 KB | a short list |
| `food-items`, `meal-types` (×3), `targets` | 8 KB | one row of scalars each |
| `plan-meal-answers` (×2), `nutrition-goals/[id]`, `.../recommend` | 4 KB | two uuids and a date, or one string |

`meal-plans` is the only one that needed arithmetic rather than a glance: up to 3 variants × 20 meals,
each carrying a 2,000-character note plus a snapshot of its ingredients — roughly 700 KB at the
schema's own limits, so 2 MB is generous past it.

## The optional-body route, again

`nutrition-goals/recommend` takes an optional `{ source }` and its previous shape was
`try { body = await req.json() } catch { /* default to on_demand */ }` — an absent body is the normal
case. It short-circuits only on `too_large`. Verified by calling it with **no body**: it reaches its
own `profile_incomplete` domain response, which is the proof the guard did not intercept it.

That is the third slice with routes of this shape (5, 6, now 7). The rule is holding: **check whether
the body is optional before converting, or the ordinary call breaks.**

## Verified live

`pnpm dev`, seeded user, 10 MB body at all sixteen read sites.

| | oversized | malformed | valid |
|---|---|---|---|
| all sixteen | **413** | **400**, never 500 | — |
| `nutrition-goals/recommend` | 413 | — | **no body** → its own `profile_incomplete` |
| `food-items` POST | | | **created** — real row |
| `saved-meals` POST | | | **created**, with an item referencing the food item above and `servings: 2` |
| `meal-types` POST | | | **created** |
| `targets` PUT | | | **written** |

Every probe row was deleted afterwards (`saved_meal_items` first, then the meal, item and type —
confirmed zero remaining).

Full suite against the local DB: **489 files / 4,138 tests green**. Custom Rules 49 of 49.

## Where the sweep stands

The check prints the live figure and this entry deliberately does not restate it as a target. What is
worth recording is the shape of what remains: after seven slices the leftovers are mostly **admin and
backfill routes** and a handful of one-off surfaces — the high-traffic, high-consequence and
device-facing clusters are all done.

## Not exercised

Production, and the APK. Nothing native, safe-area or WebView-shaped is touched. `saved-meals`,
`food-items` and `meal-types` are offline-first domains whose device write path is the outbox
`pushMutations` branch rather than these routes — unchanged here, so the device path is unaffected by
construction rather than by test.
