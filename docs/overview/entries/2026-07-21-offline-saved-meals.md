# 2026-07-21 — Offline saved-meal create/edit/delete (W7 §6.1 remainder)

**Branch:** `feat/saved-meals-offline` · **Version:** 1.188.0

Owner asked to finish "everything food offline, saved meals included." Saved-meal *viewing* and
*logging* were already offline (persistent cache + food-log outbox); this closes the last gap —
**creating / editing / deleting a saved meal offline** — as a proper offline-first write domain.
Scope (owner-confirmed): existing library foods only; **adding a brand-new food from scratch stays
online-only** (fails with a clear "needs a connection" message offline).

## Design — local-store domain hydrated from the page fetch (no server migration, no delta chain)
Deliberately *not* a full server→device delta domain (that would need a Postgres `updated_at`/
`deleted_at` migration on `saved_meals` and the whole getSyncDelta/pullDelta chain). Instead the local
mirror is hydrated from the page's own `cachedFetch('/api/nutrition/saved-meals')` response (the
CLAUDE.md "server responses hydrate the local store" pattern), which delivers full offline CRUD +
cross-device eventual consistency with far less risk.

## What landed
- **Server (idempotent replay):** `SavedMealSchema` accepts an optional client-minted `id`;
  `createSavedMeal`/`updateSavedMeal` now funnel through one user-scoped `writeSavedMeal` that
  `onConflictDoUpdate`s on the id (`setWhere: userId`) — so an offline create, or a create+edit
  replayed out of order, lands in place instead of duplicating or 404ing. POST route + adapter +
  repository interface pass `id` through.
- **Outbox domain `saved_meals`** added to `SYNCED_MUTATION_DOMAINS` (+ `MutationDomain` +
  `DOMAIN_LABELS`). `pushMutations` gains a `saved_meals` branch that validates the lean payload and
  delegates to `this.createSavedMeal`/`deleteSavedMeal` — no `this.db` (passes `check-push-mutations`).
- **Local store:** SQLite v16 migration adds `saved_meals` + `saved_meal_items` (registered in
  `RECONCILE_TABLES` + sign-out clear); new methods `getSavedMeals` (joins local `food_items`,
  computes totals), `upsertSavedMeal`, `deleteSavedMealLocally` (soft-delete tombstone),
  `markSavedMealSynced`, and `hydrateSavedMeals` (clobber-gated on `sync_status`, prunes synced rows
  the server dropped). sync-engine flips the row to synced post-push.
- **UI (`saved-meals-sheet.tsx`):** reads local-first (`getSavedMeals`) + hydrates from the server
  fetch; create/edit/delete write local + `queueMutation` and update the UI synchronously (no
  await-before-paint), with a web (`getLocalStore` null) fallback to the online-only server write.

## Verification
- tsc + lint clean (0 errors); reconcile (30 tables) + push-mutations checks pass; migrations test
  updated to v16; sync/local-store/validator suites green (55 tests).
- **APK-only, NOT device-verified:** the entire local path runs only on the S25 native SQLite
  (`getLocalStore` is null in `pnpm dev`, where the web fallback keeps the online-only behaviour, so
  no web regression). **Device-smoke:** airplane-mode → create a meal from logged foods → it appears
  instantly and in `More → sync health` as pending → edit it → delete it → reconnect → confirm all
  three land server-side and the pending count clears; confirm "add a new food from scratch" shows the
  needs-connection message offline. Recorded as a Known-Issues row in `projectOverview.md`.
