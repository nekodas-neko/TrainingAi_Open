# BF-71 — the routes shipped, the way in did not

**Branch:** `feat/bf-71-clinical-entry` · **Lane B** · v1.406.0

## What was wrong

The owner asked *"is it using the value from the RMR scan + our sedentary level?"* The answer was no,
and the reason was not a missing feature. `app/api/measured-rmr` and `app/api/dexa-scans` both
shipped complete — schema, bounds, repository methods — and `nutrition-goals/recommend` already read
`getLatestMeasuredRmr`. `grep -rn "api/measured-rmr\|api/dexa-scans"` outside `app/api/` returned
nothing. **No client code called either route**, so `measured_rmr` and `dexa_scans` were both empty
in production, the owner's 2026-08-27 results sat in a markdown file for four days, and every resting
rate the app quoted stayed predicted.

**Nothing was going to catch this.** The routes were correct. The reads were correct. An empty table
is a valid state, and no test fails because a table nobody writes to has no rows in it.

## What shipped

`app/more/clinical/` behind a new **Health → DEXA & RMR results** row in More, with the two forms in
`components/more/clinical/`. No schema moved and no route changed: this is the missing half of work
that was otherwise finished.

**The stored values sit above the forms**, because the question the screen has to answer is "did my
1,325 land, and is the app using it" — a form that saves into silence cannot answer it, and that
readback is also what makes **BF-42** runnable at all (its verification needs a measurement to
exist).

## The number, measured rather than estimated

The entry predicted the gap from the owner's own results before the feature existed. With 1,325 kcal
and 51.46 kg fat-free mass stored, `calculateBaseline` returns:

| | Predicted | With the measured test | Δ |
|---|---|---|---|
| BMR | 1485 | **1328** | −157 |
| TDEE | 1782 | **1594** | **−188** |

The entry forecast **~188 kcal/day**. That is now a measurement.

**The recommendation route is a worse instrument for this and was not used as one.** It runs an LLM,
so its `calories` moved 1950 → 1850 across the same change — a real difference that a single pair of
calls cannot attribute, because the model varies run to run. `calculateBaseline` is the deterministic
half and is where the claim above comes from.

## Two decisions worth keeping

**Only two DEXA fields are load-bearing, and the form says so with its layout.**
`getBodyFatCalibration` selects exactly `scannedOn` and `pctFat`. Those two plus weight are the first
screen; the other ~30 scalars are the owner's clinical record, read by nothing yet, and are collapsed
rather than absent. The **twelve per-region bone rows are not here at all** — 36 hand-typed fields
for data nothing reads, which is what BF-41's extraction path is for. The route makes `regions`
optional for exactly this reason.

**Mass fields echo themselves in kilograms.** The schema stores grams and bounds them 0..500,000, and
its own comment names the mistake it cannot catch: "grams entered as kilograms is the likely one".
The printout reads `Fat 20,547.5 g`; typing `20.5` is inside the bound, saves cleanly, and is wrong
by a factor of a thousand in the column BF-2's calibration reads. A tighter bound is not the fix —
the route is right that the real range spans children and adults. Showing `= 20.55 kg` under the
field is: at 20.5 g it reads `= 0.02 kg`, which is obviously not a person's fat mass.

**No invalidation group, and that is deliberate.** `lib/cache-groups.ts` is where one would go, and a
hand-rolled key list at the write site is CI-blocked. Neither key needs one: `cachedFetch` paints the
cached value and then always revalidates, neither read passes `freshWithinTtl`, and neither is
seed-only — so the entry is a first-paint accelerator, and clearing it would swap a briefly-stale
paint for a blank one. The freshly-saved record is held in state instead, which is both instant and
true.

## Verified

`tsc --noEmit` clean · `pnpm check:rules` **Ran 63 of 63** · full suite **524 files / 4773 passed**.

End-to-end against the local database, driven through the UI rather than the API: navigate from
More, enter the **real** 2026-08-27 values, and assert the columns hold them —
`measured_rmr` one row at 1325 / 51.46, `dexa_scans` one row at 28.5 % / 20547.5 g /
`source='manual'`. Real values rather than round fixtures, because a fixture of round numbers would
not have exercised the grams hazard. Three consecutive green runs.

All four unit guards are **mutation-tested**, and one of them was wrong when first written: the
caller regex `fetch\(['"]/api/dexa-scans` still matched `/api/dexa-scans-DISABLED`, so the guard
passed while the form posted nowhere. It only showed up by mutating the URL and watching the test
stay green. The terminator is now part of the pattern.

The e2e spec also caught a real flake in itself: the More row navigates through the client router, so
a tap dispatched before hydration is swallowed and the page silently stays on More. It waits for the
route boundary and asserts the URL now.

## Not exercised

- **The device, and specifically the two controls the form is built from.** `<input type="date">` is
  the picker most likely to render differently in Samsung's WebView, and every number field asks for
  `inputMode="decimal"` because several values are fractional (BMD 1.046, T-score −1.6) — a keypad
  with no decimal point would make them untypeable. Neither has been seen on the S25. BF-71 stays
  queued on that check alone.
- **Offline.** There is no outbox domain behind either route, so a save with no connection fails
  visibly rather than queueing. That is the standing rule's second branch, chosen deliberately —
  adding the first would need a local table and a sync domain, which is Lane A's. The failure path
  itself was not exercised.
- **A second measurement.** Everything here was verified with one row in each table. The routes
  return lists and BF-2's calibration explicitly wants a series; how the screen reads with several is
  unknown.
