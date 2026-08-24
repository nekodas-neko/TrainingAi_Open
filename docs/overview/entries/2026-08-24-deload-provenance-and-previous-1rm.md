# 2026-08-24 — the deload leak was real, and in a query Q-298 never mentions

**Branch:** `fix/deload-provenance-and-previous-1rm` · **Lane A** · one query, one shared write path.
No migration, no APK.

## Checking the entry's claim is what found the defect

Q-298 said the zeros *"do leak into prescription"*, because `getLastRealOneRmBatch` filters on
`exercise_deloaded` and a phase-deloaded row carries `false`. Read on `main`, that query also filters
**`AND el.estimated_1rm > 0`** — so a zero never reached it. The `−100%` first-vs-last trend the entry
blamed had been fixed too, with an explicit `FILTER (WHERE estimated_1rm > 0)` and a comment saying
why. **Both named symptoms were already closed.**

Sweeping the siblings for the same predicate turned up the one that did not have it.

## `listPrevious1rm`

```sql
WHERE ws.user_id = $1 AND el.estimated_1rm IS NOT NULL   -- every sibling uses > 0
```

A deloaded exercise stores `estimated_1rm = 0` **on purpose** — deload work is submaximal and must
not read as a max. `IS NOT NULL` admitted it, so whenever the last-but-one session for an exercise was
a deload, **the previous 1RM was zero.**

**And the two consumers disagreed about it, which is what makes it worse than a display bug:**

| consumer | guard | what it reported |
|---|---|---|
| `oneRmTrendStatus` | `previous <= 0` → `'none'` | **flat** |
| `signals.ts` `rm1ChangeKg` | `current - prev`, none | **the entire 1RM as a gain** |

Both go to the AI periodization signals. A deload two sessions back told the model the lifter had
gained their whole one-rep max since last time, while the trend beside it said nothing had changed.

Fixed at the source — one query, both consumers.

## And the provenance stamp, which was the entry's own fix

The estimate and the stored flag now come from one named predicate:

```ts
const deloadedForEstimate = exerciseDeloaded === true || (isAnyDeload && !isBaseline)
```

Before, line 223 zeroed the estimate on that predicate and line 304 stored `exerciseDeloaded ?? false`
— so a phase-level deload wrote a row describing itself as an ordinary set the app had happened to
decline to estimate. Naming the predicate once is what stops the two drifting apart again.

**Deliberately not changed:** what is passed to `shouldCountTowardPr`, which takes `isAnyDeload`
separately and already gates on it. This changes what is *stored*, not what is *decided*, so no PR
behaviour moves.

## Verified

- 3 DB-backed tests on `listPrevious1rm` (reaches past a deload; unaffected without one; omits the
  exercise when every prior estimate was a deload) and 3 on the provenance stamp.
- **Two mutations:** restoring `IS NOT NULL` fails 2 of the 3 query tests; storing only the AI flag
  again fails the phase-deload stamp test.
- Full suite **4,668 tests**; `pnpm check:rules` 55 of 55.

## What is left

- **The 10 historical rows** stay owner-gated — recompute or null, both edit training history. The
  forward fix does not touch them, and with every read path gating on `> 0` they are now inert
  everywhere rather than inert in two places.
- **The 0-vs-null sentinel is bigger than the entry implies.** `OneRmEstimate.estimated1rm` is typed
  `number`, so making it nullable ripples through every consumer of `calculate1RM`. With the read
  paths guarded it is a correctness improvement, not a live defect — worth doing deliberately rather
  than as a rider on this.

**Failure surfaces NOT exercised:** production — the fix is forward-only for the stamp and read-only
for the query, and the owner's 10 affected rows are historical. `signals.ts`'s consumption was traced
by reading it, not by driving an AI prescription end-to-end. Nothing device, native or offline is
touched.
