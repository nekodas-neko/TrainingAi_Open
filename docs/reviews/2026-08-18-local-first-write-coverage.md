# Review — is Q-488 the only one? Auditing every write to a local-first domain

**Date:** 2026-08-18 · **Agent:** Review · **Lens:** the generalisation of Q-488
**Findings filed:** none · **Bounds an existing finding**

## Why

Q-488 (sweep 23) found the activity delete updating the server and the caches but never the local
store, and named the shape it belongs to: *a server-reading screen writing to a local-first domain is
a blind spot by construction.* The obvious question is whether it is the only one. An implementer
taking Q-488 needs that answer, because "fix this handler" and "fix this class" are different jobs.

## Method, and the check that does not work

First pass: for every client mutating `fetch` to a local-first domain's endpoint, does the **file**
touch the local store? That produced 23 write sites and two with no store usage at all.

**That check is unsound and its own output proves it** — it reported `health-content.tsx` (the Q-488
file) as `yes`, because the file uses the store elsewhere, just not in the delete handler. File-level
coverage says nothing about a handler.

Second pass, the one that counts: for each **mutating** write, look for a local-store call **inside
that handler's window**.

## Result — every delete/patch handler writes locally except Q-488's

| Method | Handler | Local write in the handler |
|---|---|---|
| PATCH | `injury-sheet.tsx:134` | `store.upsertInjury` |
| DELETE | `injury-sheet.tsx:177` | `store.deleteInjury` |
| DELETE | `nutrition-content.tsx:492` | `store.deleteFoodLog` |
| PATCH | `quick-edit-log-sheet.tsx:80` | `store.upsertFoodLog` |
| DELETE | `saved-meals-sheet.tsx:462` | `store.deleteSavedMealLocally` |
| DELETE | `manage-supplements-sheet.tsx:164` | `store.upsertSupplement` (soft delete) |
| PATCH | `manage-supplements-sheet.tsx:205` | `store.upsertSupplement` |
| PATCH | `done-activity-screen.tsx:43` | `store.upsertPrescribedRun` |
| **DELETE** | **`health-content.tsx:688`** | **none — this is Q-488** |

**Q-488 is the sole instance.** Its fix is one handler, not a class sweep — worth knowing before
someone budgets for the latter.

## The two server-only writers, both clean

- **`lib/health-connect-sync.ts:212`** — `PATCH /api/activity-logs/[id]/metrics`, no local write.
  Audited in sweep 23: all four fields are in the pull mapping *and* `RECONCILE_COLUMNS`, so the
  enrichment arrives on the next pull. Supplementary data arriving a pull late is the intended shape.
- **`components/nutrition/meal-plan-setup-sheet.tsx:387`** — `POST /api/nutrition/saved-meals`, no
  local write, `invalidateSavedMeals()` only. **Also clean, for a different reason worth recording:**
  `saved_meals` is **push-only** in the outbox (`sync-engine.ts:894` handles it in the push-confirm
  branch; there is no pull mapping for it), and the domain is kept current by **hydrate-on-read**
  instead — `saved-meals-sheet.tsx:111` fetches the API and calls `store.hydrateSavedMeals(list)`,
  and `food-logger-sheet.tsx:196-201` falls back to the API when the local lookup misses. Both
  readers reach the server, so a server-only create is visible immediately.

That second one is the useful nuance: **"no pull mapping" is not evidence of a gap.** A domain can be
kept fresh by hydrate-on-read, and `saved_meals` deliberately is. A future audit that tests for pull
coverage alone would file it wrongly.

## Not verified

Static audit and source reading. Not on the APK. The handler-window heuristic reads a fixed span
around each call site; a local write further away than that window would be missed, though for the
eight above the call is within a few lines.
