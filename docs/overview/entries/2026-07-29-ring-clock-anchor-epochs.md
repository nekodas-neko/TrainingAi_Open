# Ring clock anchors become append-only observations (Q-23 §1 / Q-22 §2, phase 1)

The owner's call on the two Q-23 options was *"do the future proof and more correct option; I want
the good option not the easy option"* — so this takes the root cause rather than guarding the three
consumers that trip over it.

## What was wrong

`oura_ble_clock_anchors` held **exactly one row** for the owner, created at the 2026-07-07 re-key and
mutated forward on every ingest since. `getOuraClockAnchor` returned it and it was applied to **every
`ds` in the database**.

A single anchor does not *stretch* time — the ring counter and UTC both tick at ~1 s/s — so
ring-vs-ring intervals were always fine. What it does is **offset every ring timestamp by that one
row's lag**: the gap between when the newest drained event actually happened and when it reached the
server. The redecode route's own comment records that lag reaching hours ("6,038 sleep events
collapsed into the 09:00 drain hour"). Three consequences:

1. **Ring-vs-wall-clock crossings are wrong by that lag** — Q-23 §1 exactly. `preferStrapBuckets`
   interleaves ring rows with chest-strap rows on true phone time, and three consumers treat adjacent
   gaps as elapsed seconds.
2. **Day boundaries move.** `dayForDs` derives the local day from the same conversion, so every
   re-anchor slides historical day boundaries — and because the steps rollup's max-merge can only
   raise a stored day, the resulting inflation **ratchets in** and never comes back out.
3. **A ring clock reset was silently fatal.** The update was strictly forward-only, so after a re-key
   or dead battery the new small `ds` values could never move the anchor: every post-reset frame
   mapped weeks into the past *and* fell below `rollupCutoffDs`, contributing **zero**, permanently,
   with nothing surfaced. Migration 115's own comment describes the intended one-row-per-epoch model;
   the code never implemented it.

## Phase 1 — what landed

An anchor is now an **observation** of `(ring counter ↔ wall clock)`, not a setting.

- **Migration 161** — `epoch` + `observed_source` on `oura_ble_clock_anchors`, `epoch` on
  `oura_raw_samples`. Everything already stored is epoch 0.
- **`lib/oura-ble/clock.ts`** — `resolveDsToMs` / `resolveMsToDs`. A `ds` resolves against the
  observation **nearest it**, not the newest one, which bounds the error to one drain interval
  instead of "time since the last sync"; with observations either side it **interpolates**,
  absorbing ring drift a fixed 100 ms/ds slope cannot; and it is restricted to the frame's own epoch,
  returning `null` rather than inventing a time when there is no observation to use.
- **Ingest** appends an observation per advancing batch instead of mutating one, and a batch whose
  max `ds` drops materially below the epoch's high-water mark opens **epoch + 1** with a loud log
  line. Samples are stamped with the epoch they arrived under — without that column a reset makes
  historical `ds` values permanently ambiguous.

There is deliberately **no `epochForDs`**. After a reset the counter restarts low, so epochs cover
overlapping `ds` ranges and a bare `ds` is genuinely ambiguous; a function claiming to resolve it
would be guessing. Rows carry their epoch; callers holding only a `ds` (the accel and live-step
routes) are always talking about now, and get `currentEpoch`.

## This changes no timestamp yet — on purpose

**Every read still uses the single newest anchor.** Today's numbers are exactly as wrong as
yesterday's. What changed is that the database has started *recording* the observations phase 2
needs, and phase 2 cannot be evaluated until enough exist to bracket real frames. Landing the write
side inert makes the improvement measurable rather than assumed.

**Phase 2** (queued, Q-23) switches the ~11 read sites — eight in `adapter.ts` plus the
`step-counter-export`, `accel-chunks` and `live-steps` routes — from `getOuraClockAnchor` +
`measuredAtMs` to `getOuraClockAnchors` + `resolveDsToMs`, handling the `null` return. Deliberately
**not** bundled with the step backfill: day assignment may shift, and conflating that with the step
corrections already pending would make both unreviewable.

## Verification

- **Unit** (`lib/oura-ble/__tests__/clock.test.ts`, 12): nearest-observation selection *against a
  newest observation carrying an hour of lag* — the failure mode itself, not a rephrasing of the
  code; interpolation across a 10%-slow span; epoch isolation; `null` with no observation. Plus a
  property test that ring-vs-ring intervals stay exact across the interpolated span — those are
  correct today and a regression there would be worse than the bug being fixed.
- **DB-backed** (`oura-ble-clock-epochs.test.ts`, 5): three advancing batches leave three rows;
  a replayed backfill batch records nothing (an `(oldDs ↔ now)` pair would be actively wrong);
  a counter restart opens epoch 1; samples carry their epoch. **Confirmed red** by stubbing
  `isClockEpochReset` to `false` — two failed, three passed, which is the right split.
- **Live route**, `pnpm dev` + `POST /api/oura-ble/samples` as an admin: four batches produced four
  anchor rows (`3000000, 3000600, 3001200` at epoch 0, then `900` at epoch 1), samples stamped to
  match, and the reset log line fired. Test rows removed afterwards.
- Full suite, typecheck, lint, build, `check-push-mutations` all clean. Migration 162 regenerates the
  `claude_ro` views — diff against 160 is exactly the three new columns.

## Not exercised

Nothing here runs on-device (server + migrations only), so no APK rebuild is needed and the device
smoke checklist does not apply. The reset path is proven against a synthetic counter restart, not a
real re-key — a real one also changes the BLE session and is the scenario `docs/oura-ble-operations.md`
treats as a full protocol re-validation.
