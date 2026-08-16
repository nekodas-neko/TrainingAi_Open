# 2026-08-08 — Closing four drifts between the two write paths

**Domain:** platform — v1.270.8, JS-only (no APK rebuild)

Q-131, from the 2026-08-07 full-app review (§4). All four are the "web route and `pushMutations`
have drifted" class. None is reachable from today's UI, so this is hygiene — but each becomes live
the moment the relevant path is made offline-capable, and this is the bug class that has produced
three production incidents.

## 1. `mood_logs` push had no validation at all

The web route parses a Zod schema with enums and array caps; the push branch cast straight through
(`p.energyLevel as EnergyLevel`). A corrupted payload writes an arbitrary string into the `NOT NULL`
`energy_level` column, and every readiness and energy surface then renders it as a real check-in.
Every sibling domain got a shared schema under SYNC-P3/P4/Q-24; mood was missed.

New `packages/shared/src/validation/mood-log.ts` (`MoodFieldsSchema`), parsed by both paths — the
web route's local `MoodSchema` is now that import. A failing payload is quarantined with an error,
not written.

## 2. `food_items` push dropped fields the schema already accepted

`FoodItemPushSchema` accepts `barcode` and `region`, and the branch passed neither: `barcode` was
dropped entirely and `region` hardcoded to `''` against the web route's `?? 'AU'`. An item saved
offline therefore lost the barcode a later rescan matches on. The serving-size default also differed
— `?? 0` here against the web route's `?? 100`, which collapses every per-serving calculation
downstream. Both now match the web route.

## 3. The pull chain dropped four columns present on both ends

`workout_sessions.session_id` / `intensity_mode` / `was_override` and
`exercise_logs.exercise_deloaded` exist in the server schema *and* the local schema (all four are in
`RECONCILE_COLUMNS`), but the pull mapping in `sync-engine.ts` never read them and the `applyDelta`
inserts never wrote them. Those columns exist specifically so a stranded outbox replay keeps real
phase attribution — without them a replay on a restored device silently degrades to name-fallback
attribution, and a deloaded exercise comes back as a full-intensity one.

Added to both the mapping and the two inserts. The server already sends them: `getSyncDelta` selects
whole rows for these tables, so nothing changed on the wire.

## Verification

`tsc --noEmit` clean · `eslint` matches the pre-existing baseline (48 warnings before and after —
the one new warning this introduced, an now-unused `z` import in `mood/route.ts`, was removed rather
than left) · full suite 407 files / 3227 tests, one failure
(`scale-ble-multi-reading.test.ts`) that **also fails on a stashed clean tree** — needs a second user
row the local seed lacks. Pre-existing, unrelated.

New tests:

- Two in `push-mutations-web-parity.test.ts` — the push branch rejects an out-of-enum `energyLevel`
  exactly as the web route 400s it (and writes no row), and a pushed `food_item` keeps its barcode,
  defaults `region` to `AU` and `serving_size_g` to 100. **Both fail against the pre-fix adapter**
  (stashed it and re-ran: 2 failed / 21 passed), so they test the fix, not the harness.
- Two in `sqlite-backend.test.ts` — the `workout_sessions` and `exercise_logs` pull inserts carry the
  four previously-dropped columns, asserted on both the statement and the bound parameters.

**Not exercised:** no on-device run and no live offline replay. The pull-mapping half only shows
itself on a device restored from sync, which this sandbox cannot produce (native SQLite does not run
here) — it is covered by the statement-level tests and the existing `insert-arity` guard. The two
push-branch halves are DB-backed and genuinely executed. No native, safe-area or gesture surface
touched.
