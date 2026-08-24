# The water widget's generic sheet treats water as an increment, like everything else does (Q-319)

**Branch:** `fix/water-widget-web-fallback` · **Lane B** · v1.363.6

## The entry's premise needs two corrections, and the second changes the fix

**1. The bug is not reachable from the UI, and never was.** Q-319 says the water tile's Log button
opens `log-value-sheet.tsx`. It does not: `metric-tiles-card.tsx:89` branches on `waterIntake` and
calls `onLogWater()`, which opens `components/profile/water-log-sheet.tsx` — the correct sheet, on
the correct route. `LogValueSheet` is reachable only via `onLogTile`, which that branch bypasses for
water. The diversion has been there since the public snapshot (2026-08-16), two days **before** this
entry was filed. The entry's measurement was real but was a direct route call, not a UI drive.

Confirmed against the running app: `POST /api/body-metadata {"localDate":…,"waterIntake":750}`
returns **`400 {"error":"Invalid input"}`**, exactly as the entry's ⚠ note predicts post-Q-464.

**2. The device path is NOT fine, which the entry states twice.** `log-value-sheet`'s local branch
wrote `waterMl: numVal` — an **absolute** — and queued `{ waterMl: numVal }`. Water is an increment
everywhere else:

- `components/health/metric-bounds.ts:51` bounds `waterIntake` with `validWaterMlDeltaOrNull` and
  its comment says outright *"A water ENTRY is an increment"*.
- `water-log-sheet.tsx` read-merges locally and queues **`waterMlDelta`**, with a comment naming
  **SYNC-P7**: an absolute total in the push branch made concurrent adds on two devices clobber each
  other.
- `adapter.ts:3901` routes `waterMlDelta` through `incrementWaterLog`, the same function the web
  route uses, and dedupes it on the mutation id because it is the one non-idempotent branch.

So this sheet held a second, contradicting copy of the water write — an absolute set that both
discards the day's accumulated water (`upsertBodyMetric` overwrites every column) and reintroduces
SYNC-P7. That is a latent write-path defect, not a semantic quibble.

## What shipped

`log-value-sheet.tsx`'s water case now matches its sibling on all three paths: read-merge the day's
total locally, queue `waterMlDelta`, and post to `/api/water-log` in the web fallback. The optimistic
paint increments rather than replacing, for the same reason.

Kept rather than deleted, deliberately. Dead code that is *wrong* is a trap: whoever later routes a
water widget through the generic sheet would otherwise inherit both the clobber and the 400.

## Verification

Driven against `pnpm dev` + local Postgres by mounting `LogValueSheet` with the water widget on a
scratch route — the tile cannot reach it, which is the point above:

| logged | `POST /api/water-log` | `body_metrics.water_ml` |
|---|---|---|
| 300 ml | 200 | 750 → **1050** |
| 200 ml | 200 | → **1250** |
| 150 ml | 200 | → **1400** |

Three successive entries **summed** instead of overwriting. Before the change the same flow sent
`waterIntake` to `/api/body-metadata` and got a 400 with the value lost.

`tsc --noEmit` clean · `eslint` zero new warnings · `pnpm check:rules` **Ran 55 of 55**.

## Not exercised

**No user-visible behaviour changed, because nothing user-visible could reach this branch.** This
closes a latent defect and removes a 400; it does not fix something the owner can currently hit.

**The optimistic paint's absolute value was not verified against the real screen.** The scratch
harness passes a no-op `fetchMeta`, so its starting `waterMl` stays null and the painted totals read
300/500/650 rather than the true day total. The *increment* is what was under test and it is correct;
reconciliation is `fetchMeta`'s job on the real screen and was not driven.

**The local-store branch was not exercised at all** — `getLocalStore` returns null in the web
sandbox, so only the web fallback ran. The read-merge and the `waterMlDelta` queue are read-and-typed
only, and they are the half that matters on the canonical runtime. Owed a device check.

Nothing checked on the S25.
