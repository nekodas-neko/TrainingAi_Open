# 2026-08-24 — six admin request schemas made strict (Q-464 sweep, 85 → 79)

**Branch:** `fix/strict-admin-schemas` · **Lane A** · server only, no migration, no APK.

Q-464's ratchet and its first four conversions shipped on 2026-08-18/23. What is left is a sweep of
79 non-strict request schemas, and the entry is explicit that there is no shortcut: each one needs
the client that posts to it read, because a codemod would introduce silent 400s on rarely-exercised
routes and no test would catch them.

Six converted here, all under `app/api/admin/`. Each was checked against the component that posts to
it before the `.strict()` went on:

| route | client | keys sent |
|---|---|---|
| `activity-types` | `components/admin/activity-type-manager.tsx` | `{label, icon, isDistanceBased, sortOrder}` (+`id` on PATCH) |
| `ai-usage` | `components/admin/ai-usage-tab.tsx` | `?sinceHours=` only |
| `exercises` | `components/admin/exercise-manager.tsx` | the seven `Omit<ExerciseRow,'id'>` keys (+`id` on PATCH) |
| `fix-exercise-units` | `components/admin/exercise-unit-fix.tsx` | `{exerciseNames, beforeDate, apply}` at both call sites |
| `generate-exercise-media` | `components/admin/exercise-manager.tsx` | `{exerciseName, gender, force}` |
| `mirror-dataset-gifs` | `components/admin/exercise-manager.tsx` | `{exerciseName, force}` / `{exerciseName}` |

## The two that justify the entry's "no shortcut"

`activity-types` and `exercises` PATCH both post `{id, ...data}` against a schema that names no `id`.
Read at the schema, that is a route a codemod would either skip (wrongly, since POST is safe) or
convert and break. Read at the *handler*, both do `const { id, ...rest } = body` and parse `rest`, so
the schema never sees `id` and strict is safe on both verbs. Round-tripped live to confirm.

## And one that is cheaper than the sweep assumes

`admin/ai-usage` never receives a client-supplied object at all — the route reads three named
`searchParams` into a literal. An unknown query key is structurally unable to reach the schema, so
`.strict()` guards nothing today. It was still added: it costs nothing, and it catches the day
someone replaces the literal with a spread of `Object.fromEntries(searchParams)`. What matters for
the remaining 79 is that this shape needs **no client verification** — recorded in the checker's
header so the next session prices it correctly rather than budgeting a full read for it.

## Verified

Live against `pnpm dev` as an admin session, not only by test:

| probe | result |
|---|---|
| `activity-types` POST valid / misspelled `sortorder` | **201** / **400** |
| `activity-types` PATCH `{id, …}` / with an unknown key | **200** / **400** |
| `exercises` POST valid / `gif_url` instead of `gifUrl` | **201** / **400** |
| `fix-exercise-units` preview / with `before_date` | **200** / **400** |
| `generate-exercise-media`, `mirror-dataset-gifs` unknown key | **400** (before any AI work) |
| `mirror-dataset-gifs` valid body | **200** `{"status":"no_match"}` |
| `ai-usage` valid / with a stray query param | **200** / **200** (the route never passes it on) |

Full suite **561 files / 4,603 tests**; `pnpm check:rules` **54 of 54**; probe rows deleted from the
local dev DB afterwards.

**Failure surfaces NOT exercised:** the two media routes' *success* paths — a valid body for a real
exercise triggers AI generation and an external dataset fetch, so only the schema-rejection path and
`mirror`'s `no_match` branch were driven. Nothing device, native, safe-area or offline is touched.
These routes are admin-only, so a 400 is visible to an admin immediately rather than dead-lettering
a user's data — which is why this batch was taken first.
