# Ring clock anchors: append-only observations, epoch-aware, contemporaneous conversion

**Status:** **Phase 1 landed 2026-07-29** (§2 schema, §2.1 resolver, §2.2 epoch detection — all
inert; reads unchanged). Phase 2 — switching reads to `resolveDsToMs` — is still to do.
Backlog: Q-23 §1 (root fix) and Q-22 §2 (same root).
**Owner decision (2026-07-29):** take the correct, future-proof fix rather than the cheap guard.

---

## 1. What is actually wrong

`oura_ble_clock_anchors` holds **exactly one row** for the owner — created 2026-07-07 at the re-key
and **mutated in place** on every ingest since (`adapter.ts:4366-4371`, `batchMaxDs > anchor.anchorDs`).
`getOuraClockAnchor` returns the newest, and it is applied to **every** `ds` in the database.

A ring timestamp becomes wall clock as `utc = anchorUtc − (anchorDs − ds)/10`. The ring's counter and
UTC both tick at ~1 s/s, so a single anchor does not *stretch* time — it **offsets every ring
timestamp by the same amount**: the anchor's own lag `L`, the gap between when the newest drained
event actually occurred and when it was ingested. The redecode route's own comment records `L`
reaching **hours** in production ("6,038 sleep events collapsed into the 09:00 drain hour").

Three consequences, all real:

1. **Ring-vs-wall-clock comparisons are wrong by `L`.** That is exactly Q-23 §1: `preferStrapBuckets`
   interleaves ring rows (offset by `L`) with chest-strap rows (true wall clock) and three consumers
   treat adjacent gaps as elapsed time. Ring-vs-ring intervals are fine; it is only the crossings.
2. **Day boundaries move.** `dayForDs` derives the local day from the same conversion, so every
   re-anchor slides every historical day boundary by the change in `L`. Frames within `L` of midnight
   migrate between days — and because the steps rollup's max-merge can only raise a stored day, the
   resulting inflation **ratchets in** and never comes back out.
3. **A ring clock reset is silently fatal.** The update is strictly forward-only, so after a re-key or
   dead battery the new small `ds` values never move the anchor: every post-reset frame maps weeks
   into the past *and* falls below `rollupCutoffDs`, contributing **zero** — permanently, with no
   error surfaced.

## 2. Target model

An anchor is an **observation** of the pair (ring counter, wall clock), not a setting. Keep every
observation; never mutate one.

```sql
ALTER TABLE oura_ble_clock_anchors
  ADD COLUMN epoch integer NOT NULL DEFAULT 0,
  ADD COLUMN observed_source text NOT NULL DEFAULT 'drain';
CREATE INDEX ON oura_ble_clock_anchors (user_id, epoch, anchor_ds);
```

- **`epoch`** — increments when the ring's counter goes *backwards*, which is the only unambiguous
  signal of a reset. Frames are resolved within their epoch and never across one.
- **Append-only.** Each ingest batch inserts one row: `anchorDs = max(ds in batch)`,
  `anchorUtc = now()`. The existing single row becomes epoch 0's first observation.

### 2.1 Resolving a `ds` to wall clock

```ts
// lib/oura-ble/clock.ts — the ONE conversion, replacing bare measuredAtMs at every call site.
resolveDsToMs(ds: number, anchors: ClockAnchor[]): number | null
```

Rules, in order:
1. Pick the epoch whose `ds` range contains this `ds` (epochs are disjoint and ordered).
2. Within that epoch, use the **nearest observation at or after** `ds` — the one whose lag is
   smallest for this frame, rather than whichever drain happened most recently. This is the whole
   point: it bounds `L` to one drain interval instead of "time since the last sync".
3. With observations either side, **interpolate** between them. That absorbs the ring's own clock
   drift, which a single offset cannot.
4. No anchor in the epoch → return `null`. Callers must handle it; today they silently compute a
   wrong time, which is worse than a gap.

### 2.2 Epoch detection at ingest

`insertOuraRawSamples` currently only moves the anchor forward. Instead:

- `batchMaxDs >= currentEpochMaxDs` → append an observation to the current epoch.
- `batchMaxDs` is **materially below** the current epoch's max (beyond a small out-of-order
  tolerance) → the counter reset. Open `epoch + 1`, append the first observation there, and log it
  loudly — this is the state that silently zeroed days.
- Samples must record which epoch they belong to, or a reset makes historical `ds` ambiguous forever.
  Add `epoch` to `oura_raw_samples`, defaulted to 0 and stamped at ingest.

## 3. Backfill

Nothing to recompute for epoch 0 — there has only ever been one epoch, and one observation. The
migration seeds `epoch = 0` on the existing anchor row and on every `oura_raw_samples` row.

**What does change:** once observations accumulate, the *conversion* of historical frames improves
as newer observations bracket them. Since `dayForDs` feeds the steps rollup, a re-run after this
lands may reassign frames near midnight. Run it with `allowStepsDecrease` on a quiet day and diff the
preview first — the preview and the write now share `computeStepsByDay`, so they will agree.

## 4. What this unblocks

- **Q-23 §1** — with ring rows on true wall clock (bounded by one drain interval, and interpolated),
  `preferStrapBuckets` can interleave honestly and the three gap-as-elapsed-time consumers become
  correct. No source-boundary guard needed.
- **Q-22 §2** — reset detection removes the silent-zero failure.
- The day-boundary ratchet stops, because `L` no longer grows with time since last sync.

## 5. Verification

- Unit: `resolveDsToMs` — nearest-after selection, interpolation between two observations, epoch
  isolation (a `ds` from epoch 0 never resolves against an epoch 1 anchor), `null` with no anchor.
- Property: for any two `ds` in one epoch, the resolved interval equals `(ds₂ − ds₁)/10` s within
  tolerance — ring-vs-ring intervals must stay exact, since they are correct today and a regression
  there would be worse than the bug being fixed.
- DB-backed: ingest a batch with a `ds` regression and assert a new epoch opens rather than the
  anchor refusing to move.
- Against production: re-resolve a known drain's frames and confirm the wall-clock times land within
  a drain interval of their `measured_at`, instead of hours adrift.

## 6. Sequencing and risk

Land the **schema + append-only writes + epoch detection** first, and leave every read on the current
single-anchor path. That is inert — it only starts recording better data. Then switch reads to
`resolveDsToMs` once several observations exist, so the improvement is measurable rather than
assumed.

**Phase 1 is done** (migrations 161/162, `lib/oura-ble/clock.ts`, the `insertOuraRawSamples` write
path). One thing worth stating plainly: **nothing improves yet.** Every read still resolves against
the single newest anchor, so today's timestamps are exactly as wrong as they were yesterday. What
changed is that the database has started recording the observations Phase 2 needs — and Phase 2
cannot be evaluated until enough of them exist to bracket real frames. That is the point of the
split, not an oversight.

Phase 2's call sites, all of which currently take `getOuraClockAnchor` + `measuredAtMs`:
`adapter.ts` ×8 (the sleep/steps/HR/battery/temp readers and the redecode pass) plus the
`step-counter-export`, `accel-chunks` and `live-steps` routes. Each becomes
`getOuraClockAnchors` + `resolveDsToMs`, passing the row's own `epoch` where the row has one and
handling the `null` return instead of silently dating the frame.

**Do not** run the step backfill in the same pass. Day assignment may shift, and conflating that with
the step corrections already pending would make both unreviewable.
