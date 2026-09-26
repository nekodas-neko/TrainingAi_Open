# LB-158 — the barcode column existed everywhere and held nothing

**Branch:** `feat/lb158-local-barcode` · **Lane A** · no Postgres migration · local SQLite **v41**

## What the entry said, and what was actually true

LB-158 was filed by Lane B while splitting RV-203 ②, and it reads as a mirroring problem:
`food_items.barcode` "exists on the server and **nowhere on the device**", so the pull delta drops
it silently and an offline re-scan has nothing to look up in. Every one of those statements about
the device is correct.

The premise underneath them is not. One query against production before writing any code:

```
source   | rows | with_barcode
---------+------+-------------
ai       |  289 |            0
barcode  |   42 |            0
text     |   10 |            0
```

**341 rows, zero barcodes — including all 42 whose `source` is literally `'barcode'`.** Nothing
was being dropped on the way to the device, because nothing was ever written. Mirroring the column
as filed would have mirrored nulls, shipped a `getFoodItemByBarcode` that could only ever return
null, and closed the entry.

The gap was one step earlier and it is almost comic in how complete the *rest* of the chain is:

- `food_items.barcode` — the column, since it was added.
- `FoodItemSchema.barcode` — the Zod validator.
- `rowToFoodItem` — the server read mapper.
- `POST /api/nutrition/food-items` — passes `body.barcode` straight through.
- `pushMutations`' food_items branch — reads `p.barcode`, **and Q-131 fixed that line specifically**
  because "the same item saved offline lost its barcode".

…and `NewFoodItem` had no `barcode` field at all, so `createFoodItem` never set one and the outbox
payload never carried one. Q-131 repaired the half it could see against a field no client sent.

## What shipped

**The write half** (this is the part that makes the column non-empty):

- `NutritionScanResult.barcode`, echoed by `/api/nutrition/barcode` from the code it was given —
  the same reasoning as BF-70's `origin` beside it: the caller builds a row several steps later and
  nothing else on the response says *which* product this is.
- `NewFoodItem.barcode` → `createFoodItem`'s item, its local write, and its outbox payload.
- `NewFoodEntry.barcode` → `logFoodEntries`' local mirror and its queued mutation.
- `food-logger-sheet.tsx` reads it off the scan result; `ingredient-picker.tsx` passes the code it
  already held.

**The device mirror:** local SQLite **v41** (`ALTER TABLE food_items ADD COLUMN barcode TEXT`, plus
the `CREATE_FOOD_ITEMS` body and a `RECONCILE_COLUMNS` row — the three-part rule BF-39 keeps
earning), `LocalFoodItem.barcode`, the upsert, `foodItemRowToItem`, the pull delta's `foodItemCols`,
the sync-engine mapping, and `toLocalFoodItems` in `food-log-hydration.ts` — a **second** hydration
surface onto the same table, which is exactly the shape BF-72's missing `savedMealId` took.

**The read:** `store.getFoodItemByBarcode(code)`, and one shared
`lookupBarcode(code, userId)` that both scanners now call instead of fetching the route directly.

## Two decisions worth not re-litigating

**The local upsert COALESCEs `barcode`, and it is the only column here that does.** A code is known
*only* at the scan; every other write to that same id offers null — logging the food again from
Recent, a saved meal containing it, a hydrate from a payload without the column. Under
`barcode=excluded.barcode` the first of those wipes it, and the feature is dead on the second scan.
A product's code does not change, so there is no legitimate update this drops. It is a mutation
target and killing it fails a test.

**The Lane B footprint is deliberate and small.** The path rule sends a both-halves entry to Lane A
engine-first, and the engine half alone would have been unobservable here: a column nothing writes
and a lookup nothing calls. So the shared helper carries the logic (Lane A) and the components
changed by a line each — two `barcode:` passes and two `fetch` → `lookupBarcode` swaps.

## What two shrink-only ratchets caught, and why the first number was wrong

The full suite failed two files, both correctly.

`check-bare-api-fetch.js` asked to lower `capture-actions.tsx` 1→0 and `ingredient-picker.tsx` 2→1.
**That reading was flattering and wrong**: it enumerates via `git ls-files`, and the new helper was
still untracked, so its own bare GET was invisible. Staged first, the honest picture is two sites
collapsing into one — **net −1, not −2** — and `barcode-lookup.ts` carries a baseline row of its
own. It is baselined rather than exempt: a barcode→product mapping is genuinely cacheable, so there
is no "must not be cached" claim to make.

`rv203-local-first-capture.test.ts` pinned `capture-actions.tsx` at exactly two `/api/` calls. It is
one now — the file went *further* local-first than RV-203 asked, rather than losing a read — so the
assertion is updated to 1 plus the negative that the barcode URL is gone from it.

## Verification

Full suite **10,314 passed / 87 skipped**; lint 0 errors and 796 warnings, identical to `main`;
`check-test-typecheck` at baseline (317/88); Custom Rules **80 of 80**.

15 tests across three files. Mutation pass, 5 real mutants + 1 control:

| mutation | killed |
|---|---|
| `barcode=excluded.barcode` instead of COALESCE | 1 |
| `createFoodItem` drops it from the outbox payload | 1 |
| `lookupBarcode` skips the library | 1 |
| a 500 reports as `notFound` | 1 |
| the route stops echoing `validCode` | 1 |
| **control:** name the code in a local const first | **0 — survived, as intended** |

On the dev server: a food item created with a barcode lands in the column (`9300601000876`), the
same item pushed through `/api/sync/push` as an offline mutation lands too (`9310072021234`), and
`/api/sync/pull` returns the code in its `foodItems` delta. Both were verified against the local
Postgres rather than inferred from the response.

## Not exercised

**The library-first read itself, end to end.** `getLocalStore` returns null in the sandbox — native
SQLite does not run here — so the local hit is covered by unit tests with a fake store and by the
mutation that kills it, never by a real device read. This is the offline-first rule's own step 5.

**Open Food Facts is unreachable from this container** (`/api/nutrition/barcode` returns
`{"unavailable":true}`), so the route's echo of the code is proved by its unit test rather than by a
live lookup.

**No device, and nothing scanned.** A real camera has never handed a code to this path.
