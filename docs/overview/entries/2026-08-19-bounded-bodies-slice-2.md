# 2026-08-19 — Q-322 slice 2: the six offline-first hot paths

**PR #184** · branch `fix/bounded-bodies-slice-2` · Implementation Lane A · JS/server only.

Slice 1 (PR #182) converted the three routes reachable without a session and added the shrink-only
ratchet. This takes the next six by exposure: the write paths the offline outbox actually uses.

| route | cap | why that number |
|---|---|---|
| `sync/push` | 4 MB | **measured** — see below |
| `log-exercise` | 64 KB | a schema-maximal payload is 6,010 bytes; ten times that |
| `nutrition/food-logs` POST | 8 KB | a date, two ids and a multiplier |
| `nutrition/food-logs/[id]` PATCH | 4 KB | one number |
| `complete-workout` | 4 KB | a UUID and a timestamp |
| `water-log` | 4 KB | a date and a millilitre count |

## `sync/push` is the one that needed measuring, not estimating

It is the outbox, and **a rejected batch is the app's worst-case data-loss path** — a cap set too low
does more damage than no cap at all. So it was measured rather than guessed:

- The envelope caps a batch at **100 mutations**.
- The largest *bounded* domain is `workout_log`. Every array in `LogExercisePayloadSchema` caps at 20
  and every string at 200, so a payload built at those exact limits is **6,010 bytes**.
- A full batch of the worst case is therefore **0.57 MB**. The cap is **4 MB** — seven times that.

**Stated honestly, because the measurement does not cover everything:** 0.57 MB is measured for one
domain. `MutationSchema.payload` is `z.record(z.string(), z.unknown())`, so the envelope bounds none
of the other eighteen — their per-domain schemas do, inside `pushMutations`, *after* this parse. The
headroom is what covers them. That reasoning is in the constant's docstring, along with an instruction
not to lower it without re-measuring.

## Two of the six were returning 500 for a malformed body

`nutrition/food-logs` POST and its `[id]` PATCH called `await req.json()` with no `.catch()`. A
malformed body threw out of the handler and Next answered **500** — a server fault for what is
plainly a bad request. `readJsonLimited` returns `invalid_json`, so both now answer 400. Verified
live: `{not json` → `400 {"error":"Invalid JSON"}`.

## Typing, as a consequence rather than a goal

`food-logs` POST destructured from an `any`. With the body now `unknown`, `mealTypeId` and
`foodItemId` needed explicit `typeof === 'string'` checks — they previously went into
`foodLogRefsValid` and `createFoodLog` on a truthiness check alone. Same shape as the `auth/register`
correction in slice 1.

## Verified live

`pnpm dev`, logged in as the seeded test user, 10 MB body:

| route | oversized | malformed | valid |
|---|---|---|---|
| `water-log` | 413 | 400 | 200, day written |
| `log-exercise` | 413 | — | — |
| `complete-workout` | 413 | — | 400 on a non-UUID id, unchanged |
| `sync/push` | 413 | — | 200 on an empty batch |
| `nutrition/food-logs` | 413 | 400 | **201** |

That 201 is the one that mattered: a real `food_items` row created and logged against a real meal
type, with a **slash-form date** (`2026/08/19`) normalising to dashes and `quantityMultiplier: 1.5`
surviving intact. Slice 2 touches the offline-first food path, so proving it still writes was the
point of the exercise, not a formality.

Full suite against the local DB: **486 files / 4,099 tests green**.

## The ratchet moved

104 bare reads across 92 files → **98 across 86**. The six converted files are removed from the
baseline, so re-adding a bare read to any of them fails immediately.

## Not exercised

Production, and the APK — so the *device* side of the outbox was not replayed through the new
`sync/push` cap. The web route and the push branch share their schemas, and a real batch is 0.57 MB
against 4 MB in the worst case, but a device replay was not induced. Nothing native, safe-area or
WebView-shaped is touched.
